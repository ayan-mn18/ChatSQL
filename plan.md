---

# **1. Users**

Holds authentication + profile details.

```sql
Users {
    id                UUID PK
    email             TEXT UNIQUE NOT NULL
    password_hash     TEXT NOT NULL
    username          TEXT UNIQUE
    profile_url       TEXT
    created_at        TIMESTAMP
    updated_at        TIMESTAMP
}
```

---
 
# **2. Connections**

A user can create many DB connections.

```sql
Connections {
    id               UUID PK
    user_id          UUID FK -> Users(id)
    name             TEXT NOT NULL               -- "Production Postgres", "Analytics DB"
    host             TEXT NOT NULL
    port             INT NOT NULL
    type             TEXT NOT NULL               -- postgres, mysql, mssql, mongodb...
    db_name          TEXT NOT NULL
    username         TEXT NOT NULL               -- username for DB connection
    password_enc     TEXT NOT NULL               -- encrypted & stored safely
    extra_options    JSONB                       -- ssl, read_replica, timeouts
    is_valid         BOOLEAN                     -- from test connection
    created_at       TIMESTAMP
    updated_at       TIMESTAMP
}
```

---

# **3. Queries (History + Saved Queries)**

Every executed query — manual or via AI.

```sql
Queries {
    id              UUID PK
    user_id         UUID FK -> Users(id)
    connection_id   UUID FK -> Connections(id)

    query_text      TEXT NOT NULL
    raw_result      JSONB                         -- full result (limited rows)
    row_count       INT
    execution_time  INT                            -- ms
    status          TEXT                           -- success, error
    error_message   TEXT

    is_saved        BOOLEAN DEFAULT false
    saved_name      TEXT                           -- only if is_saved = true

    created_at      TIMESTAMP
}
```

---

# **4. AI Query Generator Logs**

To track conversions from plain English → SQL.

```sql
AIQueryLogs {
    id               UUID PK
    user_id          UUID FK -> Users(id)
    connection_id    UUID FK -> Connections(id)
    
    prompt_text      TEXT         -- "Show me all buyers from last week"
    generated_query  TEXT
    created_at       TIMESTAMP
}
```

---

# **5. Table Metadata (Cached for Faster Visualization)**

We store fetched schema details to speed up ERD + table explorer.

```sql
TableSchema {
    id               UUID PK
    connection_id    UUID FK -> Connections(id)
    table_name       TEXT
    schema_json      JSONB        -- columns, datatypes, keys
    last_fetched_at  TIMESTAMP
}
```

---

# **6. ERD Relationships Metadata**

Computed automatically.

```sql
ERDRelations {
    id               UUID PK
    connection_id    UUID FK -> Connections(id)

    table_from       TEXT
    table_to         TEXT
    column_from      TEXT
    column_to        TEXT
    relation_type    TEXT          -- one-to-many, many-to-many, pk-fk

    created_at       TIMESTAMP
}
```

---

# **7. Dashboards (User-Created Analytics)**

Each connection can have many custom analytics widgets.

```sql
Dashboards {
    id                UUID PK
    user_id           UUID FK -> Users(id)
    connection_id     UUID FK -> Connections(id)
    name              TEXT
    layout_config     JSONB          -- grid layout settings
    created_at        TIMESTAMP
    updated_at        TIMESTAMP
}
```

**Dashboard Widgets:**

```sql
DashboardWidgets {
    id                UUID PK
    dashboard_id      UUID FK -> Dashboards(id)

    type              TEXT            -- chart, table, counter, kpi, custom-sql
    sql_query         TEXT
    config_json       JSONB           -- chart type, axes, filters
    refresh_interval  INT             -- ms

    created_at        TIMESTAMP
}
```

---

# **8. Data Explorer States (Filters, Sort, Pagination)**

This powers the “search, filter, edit rows” UI.

```sql
DataExplorerStates {
    id                UUID PK
    user_id           UUID FK -> Users(id)
    connection_id     UUID FK -> Connections(id)
    table_name        TEXT

    filter_json       JSONB        -- { column, operator, value }
    sort_json         JSONB
    pagination_json   JSONB        -- page, limit
    view_prefs        JSONB        -- hidden cols, order

    updated_at        TIMESTAMP
}
```

---

# ✅ **This Model Supports Everything You Mentioned**

### ✔ SQL editor

### ✔ Query history

### ✔ Saved queries

### ✔ AI query generation

### ✔ ERD visualization

### ✔ Table explorer (search, filter, edit rows)

### ✔ Multi-database support

### ✔ Analytics dashboards
