// Runs before each test file's module graph loads, so store/db.ts (which
// reads MIDDLEWARE_DB_PATH at import time) always sees an isolated
// in-memory database - never the real services/middleware/data/*.sqlite3 file.
process.env.MIDDLEWARE_DB_PATH = ":memory:";
process.env.DASHBOARD_JWT_SECRET = "test-only-dashboard-secret";
process.env.BLOCKCHAIN_WRITE_ENABLED = "false";
