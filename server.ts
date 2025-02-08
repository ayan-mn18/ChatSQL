import dotenv from 'dotenv';
dotenv.config();
// Import the 'express' module
import express from 'express';
import morgan from 'morgan';

import { getQuery } from './src/service/openai';
import { Sequelize } from 'sequelize';

// Create an Express application
const app = express();
app.use(morgan('dev'));
app.use(express.json())

// Set the port number for the server
const { PORT } = process.env;

// Define a route for the root path ('/')
app.post('/api/getQuery', async (req, res) => {
  const {query, uri} = req.body;

  const resp = await getQuery(query, "", uri);
  console.log("query: ", resp)
  const sequelize = new Sequelize(uri);
  if(resp == "" || resp == undefined) {
    res.json({
      "data": resp
    })
  }
  const data = await sequelize.query(resp);
  res.json({
    "data": data
  })
  
});

// Start the server and listen on the specified port
app.listen(PORT, () => {
  // Log a message when the server is successfully running
  console.log(`Server is running on http://localhost:${PORT}`);
});