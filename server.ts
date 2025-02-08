import dotenv from 'dotenv';
dotenv.config();
// Import the 'express' module
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';

import { getQuery } from './src/service/openai';
import { Sequelize } from 'sequelize';

// Create an Express application
const app = express();
app.use(morgan('dev'));
app.use(express.json())
app.use(cors({
  origin: "*"
}))

// Set the port number for the server
const { PORT } = process.env;

// Define a route for the root path ('/')
app.post('/api/getResult', async (req, res) => {
  try {
    const {query, uri} = req.body;

  const resp = await getQuery(query, "", uri);
  console.log("query: ", resp)

  if(resp === "" || resp === undefined || resp === null) {
    res.json({
      "data": resp
    })
  }

  const sequelize = new Sequelize(uri);
 
  const data = await sequelize.query(resp);
  res.status(200).json({
    "data": data[0]
  })
  
  } catch (err) {
    console.log(err);
    res.status(401).json({
      err: "Invalid Prompt"
    })
  }
  
});

// Start the server and listen on the specified port
app.listen(PORT, () => {
  // Log a message when the server is successfully running
  console.log(`Server is running on http://localhost:${PORT}`);
});