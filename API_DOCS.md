# ChatSQL UI - Frontend Architecture & API Integration Specification

## Overview
ChatSQL is an AI-powered database query interface where users connect to databases through a multi-step wizard and execute natural language queries that get converted to SQL. The frontend manages database connections, query execution, and results visualization.

---

## 1. Database Connection Management

### 1.1 Connection Data Model
```typescript
interface DatabaseConnection {
  id: string;                          // Unique identifier (auto-generated)
  name: string;                        // User-friendly connection name
  type: 'postgres' | 'mysql' | 'mongodb';  // Database type
  host: string;                        // Database host/server address
  port: string;                        // Database port
  user: string;                        // Database username
  password: string;                    // Database password (encrypted locally)
  database: string;                    // Database name
  createdAt: string;                   // ISO timestamp
}
```

### 1.2 Supported Database Providers
- **Supabase** → Type: `postgres`
- **Amazon RDS** → Type: `postgres`
- **PostgreSQL** → Type: `postgres`
- **MySQL** → Type: `mysql`
- **MongoDB** → Type: `mongodb`
- **Snowflake** → Type: `postgres` (mapped as generic SQL interface)

### 1.3 Connection Lifecycle
1. **Multi-Step Wizard** (3 steps):
   - **Step 1**: Select database provider from 6 visual cards
   - **Step 2**: Enter connection details (host, port, username, password, database name)
   - **Step 3**: Test connection & save

2. **Local Storage**: All connections stored in browser's localStorage under `chatsql_connections` key

3. **CRUD Operations**:
   - **Create**: `useConnections().addConnection(connectionData)`
   - **Read**: `useConnections().connections` (returns array)
   - **Update**: `useConnections().updateConnection(id, updates)`
   - **Delete**: `useConnections().removeConnection(id)`

4. **Connection Testing**: Client-side mock test (always succeeds after 1500ms delay)
   - Backend should implement actual connection validation endpoint when ready

---

## 2. Query Execution Flow

### 2.1 Current Implementation
Users configure a global database URI in **DBSettingsModal**:
- Field: `dbUri` (connection URI)
- Field: `aiModel` ('openai' or 'claude')
- Stored in localStorage under `dbSettings` key

### 2.2 Query Request Format
```typescript
interface QueryRequest {
  query: string;      // Natural language query from user
  uri: string;        // Database connection URI
}
```

### 2.3 Query Execution Endpoint
**Endpoint**: `POST https://api.sql.bizer.dev/api/getResult`

**Request Body**:
```json
{
  "query": "Show all users with their order counts",
  "uri": "postgresql://user:pass@host:port/dbname"
}
```

**Response Format** (Expected):
```typescript
interface QueryResult {
  data: any[];        // Array of result rows
  info: {
    columns: string[];        // Column names
    error?: string;           // Error message if failed
    query?: string;           // Generated SQL (optional)
    desc?: string;            // Query description (optional)
    reasoning?: {
      steps: string[];                    // AI reasoning steps
      optimization_notes: string[];      // Performance notes
    };
    tables_used?: string[];              // Tables involved in query
    columns_used?: string[];             // Columns accessed
  }
}
```

**Error Handling**: If response status ≠ 200, throw error with message

---

## 3. New Connection Management UI Updates

### 3.1 Add Connection Dialog
- **Dialog Size**: max-w-6xl (wider for better UX)
- **Height**: h-[700px] (fixed height for consistency)
- **Layout**: Left sidebar stepper + Right content area
- **Stepper Indicators**:
  - Pending: Gray circle with number
  - Active: Blue circle with glow effect
  - Completed: Green circle with checkmark

### 3.2 Edit Connection Feature
- **Edit Button**: Pencil icon on each connection card (left of delete button)
- **Behavior**: 
  - Opens same multi-step dialog with pre-filled connection data
  - Skips Step 1 (provider selection) if editing
  - Button text changes from "Save & Finish" to "Update"
  - Requires successful connection test before updating

### 3.3 Connection Storage Location
**Component**: `ConnectionsPage.tsx`
- Displays grid of connection cards (3 columns on desktop)
- Each card shows: Name, Host:Port/Database, Database Type
- Actions: Edit (pencil) + Delete (trash) buttons
- Empty state with call-to-action when no connections exist

---

## 4. Messages & Chat Flow

### 4.1 Message Structure
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  result?: QueryResult;  // Populated for assistant messages with query results
}
```

### 4.2 Chat Page Flow
1. User enters query in input field
2. Frontend creates user message and adds to chat
3. POST request to `/api/getResult` with query + dbUri
4. Backend processes and returns results
5. Assistant message added with `result` object attached
6. Results displayed in `DataTable` component

---

## 5. Backend Integration Checklist

### 5.1 Immediate Requirements
- [ ] Implement `/api/getResult` endpoint that accepts `QueryRequest`
- [ ] Parse natural language query and convert to SQL
- [ ] Execute SQL against provided database URI
- [ ] Return response matching `QueryResult` interface
- [ ] Handle errors gracefully with error messages in response

### 5.2 Future Connection Integration
- [ ] Create `/api/testConnection` endpoint
  - Input: `{ uri: string }`
  - Output: `{ connection: boolean, error?: string }`
- [ ] Implement `/api/validateConnection` endpoint for real-time validation
- [ ] Support for dynamic schema fetching (table/column listing)

### 5.3 Query Processing Features
- [ ] Generate human-readable SQL from natural language
- [ ] Provide query reasoning/explanation
- [ ] Identify tables and columns used
- [ ] Include optimization notes for complex queries
- [ ] Cache frequent query patterns for performance

---

## 6. Frontend Architecture Summary

### 6.1 Key Components
| Component | Purpose |
|-----------|---------|
| `AddConnectionDialog.tsx` | Multi-step connection wizard (add/edit) |
| `ConnectionsPage.tsx` | View/manage all database connections |
| `ChatPage.tsx` | Main query interface with chat history |
| `DataTable.tsx` | Display query results in tabular format |
| `DBSettingsModal.tsx` | Configure active database URI |

### 6.2 Hooks
- `useConnections()`: Manage database connections (CRUD + localStorage)

### 6.3 Data Flow
```
User Input → ChatPage → API Request → Backend → QueryResult → UI Update
     ↓
Select Connection → ConnectionsPage → useConnections → localStorage
```

---

## 7. Current Limitations & Notes

1. **Connection Testing**: Currently mocked (always succeeds) - Backend should validate real connections
2. **Password Handling**: Not returned/prefilled during edit for security - user must re-enter
3. **URI Format**: Using single global URI field - Future: Migrate to per-connection URI system
4. **Database Types**: Snowflake mapped to postgres for now - May need dedicated handling
5. **Schema Discovery**: Not implemented - Backend could expose table/column metadata endpoints

---

## 8. Environment Configuration

### Frontend API Endpoints
```
Production: https://api.sql.bizer.dev
Local Dev:  http://localhost:8080
```

### Storage Keys
- `chatsql_connections` → Array of DatabaseConnection objects
- `dbSettings` → { dbUri: string, dbName: string, aiModel: 'openai' | 'claude' }

---

## 9. Example Backend Response

### Success Response
```json
{
  "data": [
    { "id": 1, "name": "John", "email": "john@example.com", "orders": 5 },
    { "id": 2, "name": "Jane", "email": "jane@example.com", "orders": 8 }
  ],
  "info": {
    "columns": ["id", "name", "email", "orders"],
    "query": "SELECT u.id, u.name, u.email, COUNT(o.id) as orders FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.name, u.email",
    "desc": "Retrieved user profiles with their order counts",
    "tables_used": ["users", "orders"],
    "columns_used": ["id", "name", "email", "orders"],
    "reasoning": {
      "steps": [
        "Identified intent: Get user information with order counts",
        "Needed to join users and orders tables",
        "Used GROUP BY to aggregate order counts"
      ],
      "optimization_notes": [
        "Added LEFT JOIN to include users with no orders",
        "Index should exist on orders.user_id for performance"
      ]
    }
  }
}
```

### Error Response
```json
{
  "data": [],
  "info": {
    "columns": [],
    "error": "Database connection failed: Access denied for user 'admin'@'localhost'"
  }
}
```

---

## Contact & Next Steps
For any clarifications on the UI flow or data structures, refer to the component files:
- `/src/components/dashboard/AddConnectionDialog.tsx`
- `/src/hooks/useConnections.ts`
- `/src/types.ts`
