# User guide

[简体中文](USER_GUIDE.md)

Extract the complete application ZIP and run Daily AI.exe on Windows. Keep its resources beside the executable. Public downloads are available on the [Daily AI website](https://www.ai4indus.com/daily-ai/); Linux is not yet fully validated.

Choose a generation mode in Settings. Local API-key mode does not require an account. Subscription mode requires sign-in and server-confirmed entitlement; logging in does not purchase a plan.

Choose a provider, enter its API key, then refresh the model list and validate connectivity. Model availability depends on provider permissions. Manual model IDs are supported. A successful connection does not guarantee sufficient quota for an entire report.

The default topic is AI agents and large language models. Create, edit, enable, disable or delete topics, including the default topic. Describe desired research or developments and exclusions. Each topic has a domestic/global preference and a minimum-item target, initially six. This is a retrieval target, not permission to invent evidence.

Generate now starts a task shown at the bottom right. Expand, collapse or cancel it. Same-day unchanged requests may be blocked as duplicates; changed topics can reuse valid unchanged-topic results. Missing or expired cache may require another full search.

Schedules support daily, weekdays and selected weekdays. The default is 09:00, with local preparation starting roughly ten minutes early. Delivery may be delayed by networking, providers or sleep. Tray mode keeps local work running; fully exiting or shutting down stops it. Remote scheduling depends on the subscription service.

Open reports in tabs, filter by month, search, favorite and manage the recycle bin. Newly generated bilingual reports switch language without another translation request. Ordinary documents expire after six months by default; favorites and digests are excluded. Permanent deletion requires care.

Date-range aggregation produces a model-written digest and moves source reports to the recycle bin after success. Failure must preserve source documents.

Use Settings to migrate the data directory. Back up both SQLite data and HTML; include WAL state when applicable. OS-bound encrypted keys may need re-entry after moving between accounts or computers.

Sharing explicitly uploads one document to the remote service. Manage its active link within the document and revoke it when needed. Revocation cannot recall downloaded copies. See [privacy](PRIVACY.md) and [FAQ](FAQ.md).
