// Runs before each test file is imported. Must set env before @forge/shared loads.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://forge:forge@localhost:5432/forge_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SESSION_SECRET ??= "test-session-secret-not-for-production-use";
