#!/usr/bin/env bash

# Test script for the new database APIs
# Make sure your server is running and you have a database URI ready

echo "Testing Database APIs..."

# Replace with your actual database URI
DB_URI="postgresql://username:password@localhost:5432/database_name"

# Test getTables endpoint
echo "Testing /api/getTables..."
curl -X POST http://localhost:3000/api/getTables \
  -H "Content-Type: application/json" \
  -d '{"uri": "'$DB_URI'"}' \
  | jq '.'

echo -e "\n\nTesting /api/getTableData..."
# Test getTableData endpoint (replace 'users' with an actual table name)
curl -X POST http://localhost:3000/api/getTableData \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "'$DB_URI'",
    "tableName": "users",
    "page": 1,
    "pageSize": 5,
    "sortBy": "id",
    "sortOrder": "asc"
  }' \
  | jq '.'

echo -e "\n\nTesting health endpoint..."
curl http://localhost:3000/api/health | jq '.'

echo -e "\n\nAPI testing complete!"
