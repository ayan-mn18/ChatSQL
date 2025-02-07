import dotenv from 'dotenv';
dotenv.config();
// Import the 'express' module
import express from 'express';
import morgan from 'morgan';


import { sequelize } from './src/config/db';
import { getQuery } from './src/service/openai';

// Create an Express application
const app = express();
app.use(morgan('dev'));
app.use(express.json())

// Set the port number for the server
const { PORT } = process.env;

// Define a route for the root path ('/')
app.post('/api/getQuery', async (req, res) => {
  const {query} = req.body;

  const resp = await getQuery(query, "");

  res.json({
    "data": resp
  })
  
});

// Start the server and listen on the specified port
app.listen(PORT, () => {
  // Log a message when the server is successfully running
  console.log(`Server is running on http://localhost:${PORT}`);
});