import dotenv from 'dotenv';
dotenv.config();
// Import the 'express' module
import express, { Request, Response } from 'express';
import morgan from 'morgan';
import cors from 'cors';

import { getQuery } from './src/service/openai';
import { getTables, getTableData } from './src/service/dataApiService';
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
app.post('/api/getResult', async (req: Request, res: Response) => {
  try {
    const {query, uri, model} = req.body;

  const resp = await getQuery(query, "", uri);
  console.log("query: ", resp)

  if(resp === "" || resp === undefined || resp === null) {
    res.json({
      "data": resp
    })
  }

  const sequelize = new Sequelize(uri);
 
  const data = await sequelize.query(resp.query);
  res.status(200).json({
    "data": data[0],
    "info": resp
  })
  
  } catch (err) {
    console.log(err);
    res.status(401).json({
      err: "Invalid Prompt"
    })
  }
  
});

// New API endpoint to get database tables with metadata
app.post('/api/getTables', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uri } = req.body;
    
    if (!uri) {
      res.status(400).json({ 
        success: false, 
        error: 'Database URI is required', 
        code: 'INVALID_PARAMS' 
      });
      return;
    }

    const { tables, totalTables } = await getTables(uri);
    
    res.status(200).json({
      success: true,
      tables,
      totalTables,
      error: null,
    });
  } catch (err: any) {
    console.error('Error fetching tables:', err);
    
    let errorCode = 'CONNECTION_ERROR';
    if (err.message.includes('connect')) {
      errorCode = 'CONNECTION_ERROR';
    } else if (err.message.includes('authentication')) {
      errorCode = 'AUTH_ERROR';
    } else if (err.message.includes('timeout')) {
      errorCode = 'TIMEOUT_ERROR';
    }
    
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch tables',
      code: errorCode,
    });
  }
});

// New API endpoint to get table data with pagination, filtering, and sorting
app.post('/api/getTableData', async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      uri, 
      tableName, 
      page = 1, 
      pageSize = 10, 
      sortBy, 
      sortOrder = 'asc', 
      filterValue, 
      columns 
    } = req.body;

    if (!uri || !tableName) {
      res.status(400).json({ 
        success: false, 
        error: 'URI and tableName are required', 
        code: 'INVALID_PARAMS' 
      });
      return;
    }

    // Validate pagination parameters
    if (page < 1) {
      res.status(400).json({
        success: false,
        error: 'Page number must be greater than 0',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    if (pageSize < 1 || pageSize > 100) {
      res.status(400).json({
        success: false,
        error: 'Page size must be between 1 and 100',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    // Validate sort order
    if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
      res.status(400).json({
        success: false,
        error: 'Sort order must be either "asc" or "desc"',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    const result = await getTableData(
      uri, 
      tableName, 
      page, 
      pageSize, 
      sortBy, 
      sortOrder, 
      filterValue, 
      columns
    );

    res.status(200).json({
      success: true,
      ...result,
      error: null,
    });
  } catch (err: any) {
    console.error('Error fetching table data:', err);
    
    let errorCode = 'QUERY_ERROR';
    if (err.message.includes('not found')) {
      errorCode = 'TABLE_NOT_FOUND';
    } else if (err.message.includes('Invalid table name')) {
      errorCode = 'INVALID_TABLE_NAME';
    } else if (err.message.includes('Invalid columns')) {
      errorCode = 'INVALID_COLUMNS';
    } else if (err.message.includes('connect')) {
      errorCode = 'CONNECTION_ERROR';
    }
    
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch table data',
      code: errorCode,
    });
  }
});

app.post('/api/testConnection', async (req: Request, res: Response) => {
  try {
    const { uri } = req.body;
    if(!uri) {
      res.status(401).json({
        "connection": false
      })
    }
    const conn = await testDbConnection(uri);
    res.status(200).json({
      "connection": conn
    })
  } catch (error) {
    res.status(401).json({
      "connection": false
    })
  }
})

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'ChatSQL API'
  });
});

async function testDbConnection(uri: string): Promise<boolean> {
  const sequelize = new Sequelize(uri);
  try {
      await sequelize.authenticate();
      await sequelize.close();
      return true;
  } catch (error) {
      console.error('Database connection failed:', error);
      return false;
  }
}

// Start the server and listen on the specified port
app.listen(PORT, () => {
  // Log a message when the server is successfully running
  console.log(`Server is running on http://localhost:${PORT}`);
});