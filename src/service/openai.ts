
import OpenAI from "openai";
import { generateTableMetaData } from "./generateDbMetaData";
import { DbMetadata } from "../../types";
import { callClaude } from "./anthropic";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: apiKey});


const system = `You are an expert SQL query generator for a PostgreSQL database. 
Your task is to generate optimized SQL queries based on user requests and provide detailed reasoning about your approach.

### Guidelines:
- Use only tables, relationships & columns from the Database Schema JSON
- Ensure all foreign keys are properly joined and maintain referential integrity
- Optimize queries to minimize full-table scans and improve efficiency
- If a required table or relationship is missing, return appropriate error information
- Never make assumptions about missing data or relationships
- Return a JSON response containing both the SQL query and your reasoning process
- The response should only be in JSON, including the desc

### Example Output:
{
  "query": "SELECT u.name, SUM(o.amount) AS total_spent FROM orders o JOIN users u ON o.user_id = u.id GROUP BY u.name ORDER BY total_spent DESC",
  "reasoning": {
    "steps": [
      "Identified primary table 'orders' containing transaction amounts",
      "Located user information in 'users' table",
      "Established join condition using user_id foreign key",
      "Applied grouping to calculate per-user totals",
      "Added descending sort for better insights"
    ],
    "optimization_notes": [
      "Used join instead of subquery for better performance",
      "Added index recommendation for user_id and amount columns"
    ]
  },
  "tables_used": ["orders", "users"],
  "columns_used": ["users.name", "orders.amount", "orders.user_id"],
  "desc": gives a detailed brief explaination of what does the data that we got
}

Database Schema:
`;

export const sanitizeResponse = (aiResponse: string) => {
  try {
    // Remove markdown code block markers and trim whitespace
    const cleanedResponse = aiResponse
      .replace(/^```json\s*/, '')  // Remove opening ```json
      .replace(/\s*```$/, '')      // Remove closing ```
      .trim();

    // Parse the cleaned JSON string
    const data = JSON.parse(cleanedResponse);
    
    // No need to sanitize the SQL query further as it's already clean
    return data;
  } catch (e) {
    console.error("Parse error:", e);
    return {
      query: "",
      reasoning: {
        steps: ["Failed to parse AI response"],
        optimization_notes: []
      },
      tables_used: [],
      columns_used: []
    };
  }
};


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

  console.log("Generating relevant metadata...")
  const relevantMetaData = await getRelevantMetaData(query, stringMetaData);
  console.log("Relevant Metadata Generated: ", relevantMetaData);

  const queryPrompts = `
  ### Task:
  Analyze the following database metadata and generate a comprehensive response including:
  1. An optimized PostgreSQL query
  2. Detailed reasoning about your approach
  3. Information about tables and columns used

  ### Rules:
  - Use only the provided metadata (tables, columns, relationships)
  - Return a complete JSON response with query and reasoning
  - Ensure queries are optimized and properly joined using foreign keys
  - Include step-by-step explanation of your thought process
  
  #### Database Metadata:
  ${relevantMetaData}
  
  #### User Query:
  "${query}"
  
  ### Expected Output Format:
  {
    "query": "Your SQL query here",
    "reasoning": {
      "steps": ["Step 1", "Step 2", ...],
      "optimization_notes": ["Note 1", "Note 2", ...]
    },
    "tables_used": ["table1", "table2"],
    "columns_used": ["table1.column1", "table2.column2"]
  }
  `;

  

  const rawResponse = await callOpenAi(queryPrompts, system+stringMetaData);
  console.log("RawResponse: ", rawResponse)

  return sanitizeResponse(rawResponse!);
}


export const getRelevantMetaData = async (queryByUser: string, metaData: string) => {
  const relevantMetaDataQuery = `

  ### Task:
- Extract **only the necessary tables, columns, and relationships** required to answer the user's query.
- Do **not** include unrelated tables or columns.
- If no relevant data exists, return "{}" (empty JSON object).
- Ensure foreign key relations are included.


### Output Format:

 ### Output Format:
  {
    "metadata": {
      "tables": [
        {
          "name": "table_name",
          "columns": ["column1", "column2"],
          "relationships": [
            { "foreign_table": "other_table", "foreign_key": "column_name" }
          ]
        }
      ]
    },
    "reasoning": {
      "table_selection": ["Reason for selecting table 1", "Reason for selecting table 2"],
      "relationship_usage": ["How relationship 1 is relevant", "How relationship 2 is relevant"]
    }
  }


### Database Metadata:
${metaData}

### User Query:
"${queryByUser}"

`;


  const response = await callOpenAi(relevantMetaDataQuery, "");
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
