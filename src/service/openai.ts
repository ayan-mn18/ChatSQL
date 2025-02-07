import { raw } from "express";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: apiKey});


const DB_METADATA = `

Database: eCommerceDB
Tables:
1. users (id INT PRIMARY KEY, name TEXT, email TEXT, created_at TIMESTAMP)
2. orders (id INT PRIMARY KEY, user_id INT, product_id INT, amount DECIMAL, order_date TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))
3. products (id INT PRIMARY KEY, name TEXT, price DECIMAL)

Relationships:
- orders.user_id → users.id (Each order is linked to a user)
- orders.product_id → products.id (Each order is linked to a product)

`;

const system = `You are an SQL query generator for a PostgreSQL database. Your goal is to generate optimized SQL queries based on user requests. 
Ensure that:
- Queries are context-aware and correctly use table relationships.
- Foreign keys are properly joined.
- Queries are efficient and avoid unnecessary full-table scans.
- Always include appropriate filtering if necessary.

Always give me responses which are only sql queries no text before and after
@Example: 
SELECT u.name, SUM(o.amount) AS total_spent
FROM orders o
GROUP BY u.name
ORDER BY total_spent DESC;

Database Schema:
`  + DB_METADATA;

export const sanitizeSQ = (aiResponse: string) => {
  // Remove markdown SQL code block markers
  let cleanedSQL = aiResponse.replace(/```sql|```/g, "");

  // Replace all newline characters \n with a space
  cleanedSQL = cleanedSQL.replace(/\n/g, " ");

  // Replace multiple spaces/tabs with a single space
  cleanedSQL = cleanedSQL.replace(/\s+/g, " ").trim();

  return cleanedSQL;
}

export const getQuery = async (query: string, sys: string) => {
  console.log(apiKey)
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    store: true,
    messages: [
        {"role": "system", "content": system}, 
        {"role": "user", "content": query}, 
    ]
});

const rawQuery = completion.choices[0].message.content;

  return sanitizeSQ(rawQuery!);
}
