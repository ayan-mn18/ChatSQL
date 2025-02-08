
import OpenAI from "openai";
import { generateTableMetaData } from "./generateDbMetaData";
import { DbMetadata } from "../../types";
import { callClaude } from "./anthropic";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: apiKey});


const system = `You are an expert SQL query generator for a PostgreSQL database. 
Your task is to generate optimized SQL queries based on user requests, strictly adhering to the given database schema. 

### Guidelines:
- **Only use tables, relationships & columns from the Database Schema JSON**.
- **Ensure all foreign keys are properly joined** and maintain referential integrity.
- **Optimize queries to minimize full-table scans and improve efficiency**.
- **If a required table or relationship is missing, return an empty query ("")**.
- **Never make assumptions about missing data or relationships**.
- **Return SQL queries only—no explanations, comments, or additional text**.

### Example Output:
\`\`\`sql
SELECT u.name, SUM(o.amount) AS total_spent
FROM orders o
JOIN users u ON o.user_id = u.id
GROUP BY u.name
ORDER BY total_spent DESC;
\`\`\`

Database Schema:
`;



export const sanitizeSQ = (aiResponse: string) => {
  // Remove markdown SQL code block markers
  let cleanedSQL = aiResponse.replace(/```sql|```/g, "");

  // Replace all newline characters \n with a space
  cleanedSQL = cleanedSQL.replace(/\n/g, " ");

  // Replace multiple spaces/tabs with a single space
  cleanedSQL = cleanedSQL.replace(/\s+/g, " ").trim();

  return cleanedSQL;
}

export const getQuery = async (query: string, sys: string, uri: string) => {
  console.log("generating db meta....")
  const metaData = await generateTableMetaData(uri);
  const stringMetaData = JSON.stringify(metaData);
  console.log("Db meta data generated: ", stringMetaData)

  console.log("Generating relevant metadata...")
  const relevantMetaData = await getRelevantMetaData(query, stringMetaData);
  console.log("Relevant Metadata Generated: ", relevantMetaData);

  const queryPrompts = `
  ### Task:
  Analyze the following database metadata and generate a valid, optimized PostgreSQL query based on the user’s request.
  
  #### Database Metadata:
  ${stringMetaData}
  
  #### User Query:
  "${query}"
  
  ### Rules:
  - **Use only the provided metadata** (tables, columns, relationships).
  - **Return an empty string ("") if the query cannot be answered**.
  - **Ensure queries are optimized and properly joined using foreign keys**.
  - **Do not include explanations, comments, or additional text—only return a valid SQL query**.
  
  ### Expected Output:
  A single SQL query.
  `;

  

  const rawQuery = await callClaude(queryPrompts, system+stringMetaData);

  return sanitizeSQ(rawQuery!);
}


export const getRelevantMetaData = async (queryByUser: string, metaData: string) => {
  const relevantMetaDataQuery = `
### Database Metadata:
${metaData}

### User Query:
"${queryByUser}"

### Task:
- Extract **only the necessary tables, columns, and relationships** required to answer the user's query.
- Do **not** include unrelated tables or columns.
- If no relevant data exists, return "{}" (empty JSON object).
- Ensure foreign key relations are included.

### Output Format:
{
  "tables": [
    {
      "name": "table_name",
      "columns": ["column1", "column2", ...],
      "relationships": [
        { "foreign_table": "other_table", "foreign_key": "column_name" }
      ]
    }
  ]
}
`;


console.log("relevantMetaDataQuery: ", relevantMetaDataQuery)


  const response = await callClaude(relevantMetaDataQuery, "");

  console.log("response from open api: ", response);
  return response;
}

export const callOpenAi = async (query: string, sys: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    store: true,
    messages: [
        {"role": "system", "content": sys}, 
        {"role": "user", "content": query}, 
    ]
});

return response.choices[0].message.content;
}
