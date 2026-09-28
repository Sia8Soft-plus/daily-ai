# Architecture

[简体中文](ARCHITECTURE.md)

Daily AI keeps reading and document management on the desktop. DSA performs retrieval and model work. The same client workflow can use a local child process or an optional proprietary remote service.

The renderer accesses only limited preload APIs. Electron main owns windows, tray, scheduling, SQLite metadata, HTML files and OS-protected credentials. local-DSA binds a random loopback port and authenticates requests with a per-launch secret.

The pipeline snapshots enabled topics, checks same-day reuse, plans topic-specific queries, retrieves public sources through search MCP and supplementary adapters, validates evidence, checks topic ownership, supplements shortages, deduplicates against recent deliveries, synthesizes bilingual content, then persists and notifies.

Source coverage is constrained by public accessibility. Search targets cannot justify invented items. A topic with insufficient evidence must be reported explicitly. The seven-day delivery fingerprint store is bounded, currently at 50,000 entries; it reduces duplicates without guaranteeing perfect semantic deduplication.

Progress follows real task events. Cancellation propagates through IPC, RPC and provider calls. Heartbeats, stage limits and overall deadlines prevent indefinite waiting. Retries and response repair are bounded.

SQLite uses WAL; HTML is stored separately. Credentials are OS-protected, but reports are not encrypted by default. Counts exclude recycled reports. Local scheduled work requires the app to remain running.

Remote entitlement is server-validated. Sharing explicitly uploads a report and has separate retention from ordinary pending results. Remote implementation and installer code are proprietary. The public tree is independent: local transport is under dsa/local, shared HTML sanitization under shared, and UI tests use synthetic service contracts. See [scope](SCOPE.md).
