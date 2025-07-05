# Database API Documentation

This document describes the new database APIs for fetching table metadata and data.

## API Endpoints

### 1. Get Tables - `POST /api/getTables`

Fetches all database tables with their metadata including columns, row counts, and descriptions.

**Request Body:**
```json
{
  "uri": "postgresql://username:password@localhost:5432/database"
}
```

**Response:**
```json
{
  "success": true,
  "tables": [
    {
      "id": "public.users",
      "name": "users",
      "description": "User account information",
      "rowCount": 1250,
      "schema": "public",
      "columns": [
        {
          "key": "id",
          "label": "ID",
          "type": "number",
          "dataType": "integer",
          "sortable": true,
          "isPrimaryKey": true,
          "isNullable": false
        },
        {
          "key": "name",
          "label": "Name",
          "type": "string",
          "dataType": "varchar",
          "sortable": true,
          "isPrimaryKey": false,
          "isNullable": false
        }
      ]
    }
  ],
  "totalTables": 3,
  "error": null
}
```

### 2. Get Table Data - `POST /api/getTableData`

Fetches paginated data from a specific table with filtering and sorting support.

**Request Body:**
```json
{
  "uri": "postgresql://username:password@localhost:5432/database",
  "tableName": "users",
  "page": 1,
  "pageSize": 10,
  "sortBy": "id",
  "sortOrder": "asc",
  "filterValue": "john",
  "columns": ["id", "name", "email"]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "created_at": "2023-01-01T10:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "pageSize": 10,
    "totalRecords": 1250,
    "totalPages": 125,
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "columns": [
    {
      "key": "id",
      "label": "ID",
      "type": "number",
      "dataType": "integer",
      "sortable": true
    }
  ],
  "error": null
}
```

### 3. Health Check - `GET /api/health`

Simple health check endpoint.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-07T16:30:00.000Z",
  "service": "ChatSQL API"
}
```

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Error Codes:**
- `CONNECTION_ERROR`: Database connection failed
- `TABLE_NOT_FOUND`: Table doesn't exist
- `INVALID_PARAMS`: Invalid request parameters
- `INVALID_TABLE_NAME`: Invalid table name
- `INVALID_COLUMNS`: Invalid column names
- `AUTH_ERROR`: Authentication failed
- `TIMEOUT_ERROR`: Operation timed out

## Features

### Security
- SQL injection prevention using parameterized queries
- Input validation for table and column names
- Connection timeouts (60 seconds)
- Page size limits (1-100)

### Performance
- Connection pooling
- Optimized PostgreSQL queries
- Pagination support
- Column-specific data fetching

### Database Support
- **PostgreSQL**: Full support with advanced features
- **MySQL**: Basic support
- **SQLite**: Basic support

## Data Type Mapping

Database types are mapped to frontend-friendly types:

| Database Type | Frontend Type |
|--------------|---------------|
| integer, bigint, decimal, numeric | number |
| varchar, text, char, uuid | string |
| timestamp, date, datetime | date |
| boolean, bit | boolean |

## Usage Examples

### Basic Table Listing
```bash
curl -X POST http://localhost:3000/api/getTables \
  -H "Content-Type: application/json" \
  -d '{"uri": "postgresql://user:pass@localhost:5432/db"}'
```

### Paginated Data with Filtering
```bash
curl -X POST http://localhost:3000/api/getTableData \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "postgresql://user:pass@localhost:5432/db",
    "tableName": "users",
    "page": 1,
    "pageSize": 20,
    "filterValue": "active",
    "sortBy": "created_at",
    "sortOrder": "desc"
  }'
```

### Testing Connection
```bash
curl -X POST http://localhost:3000/api/testConnection \
  -H "Content-Type: application/json" \
  -d '{"uri": "postgresql://user:pass@localhost:5432/db"}'
```

## Development

To test the APIs locally:

1. Start the server: `npm run dev`
2. Make sure you have a PostgreSQL database running
3. Use the test script: `./test-apis.sh` (update the DB_URI first)
4. Or use tools like Postman/Insomnia with the examples above

## Environment Variables

```env
PORT=3000
DB_CONNECTION_TIMEOUT=60000
MAX_PAGE_SIZE=100
```
