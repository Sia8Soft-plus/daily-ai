const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {validateMinimum}=require('./topic-contract');
const {normalizeUsage}=require('./model-usage');

class DailyAiDatabase {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'daily-ai.db');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        name_zh TEXT NOT NULL,
        name_en TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        report_type TEXT NOT NULL DEFAULT 'daily',
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        html_path TEXT NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS open_tabs (
        tab_id TEXT PRIMARY KEY,
        report_id TEXT,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        credential_ref TEXT,
        status TEXT NOT NULL DEFAULT 'unverified',
        is_default INTEGER NOT NULL DEFAULT 0,
        last_verified_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_usage (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_model_usage_occurred ON model_usage(occurred_at);
    `);
    const columns = table => new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    if (!columns('reports').has('topic_revision')) this.db.exec('ALTER TABLE reports ADD COLUMN topic_revision INTEGER NOT NULL DEFAULT 0');
    if (!columns('reports').has('deleted_at')) this.db.exec('ALTER TABLE reports ADD COLUMN deleted_at TEXT');
    if (!columns('reports').has('original_path')) this.db.exec('ALTER TABLE reports ADD COLUMN original_path TEXT');
    if (!columns('topics').has('updated_at')) this.db.exec('ALTER TABLE topics ADD COLUMN updated_at TEXT');
    if (!columns('topics').has('min_items')) this.db.exec('ALTER TABLE topics ADD COLUMN min_items INTEGER NOT NULL DEFAULT 6');
    if (!columns('topics').has('region_preference')) this.db.exec("ALTER TABLE topics ADD COLUMN region_preference TEXT NOT NULL DEFAULT 'global'");
    if (!columns('reports').has('is_unread')) this.db.exec('ALTER TABLE reports ADD COLUMN is_unread INTEGER NOT NULL DEFAULT 0');
    if (!columns('reports').has('notified_at')) this.db.exec('ALTER TABLE reports ADD COLUMN notified_at TEXT');
    const now = new Date().toISOString();
    if (!this.getSetting('topics_initialized', false)) {
      if (!this.db.prepare('SELECT 1 FROM topics LIMIT 1').get()) {
        const seedTopic = this.db.prepare(`INSERT INTO topics
          (id,name_zh,name_en,description,enabled,position,created_at,updated_at,min_items) VALUES (?,?,?,?,1,?,?,?,6)`);
        seedTopic.run('agents-llm', 'AI 智能体与大模型', 'AI agents & LLMs', '模型、推理、训练、工具调用、评测与应用架构', 0, now, now);
      }
      this.setSetting('topics_initialized', true);
    }
  }

  getSetting(key, fallback) {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value_json); } catch { return fallback; }
  }

  recordModelUsage({provider,model,usage,occurredAt=new Date().toISOString()}){
    const tokens=normalizeUsage(usage);
    this.db.prepare('INSERT INTO model_usage(id,occurred_at,provider,model,input_tokens,output_tokens,total_tokens) VALUES(?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(),occurredAt,String(provider||'unknown'),String(model||'unknown'),tokens.inputTokens,tokens.outputTokens,tokens.totalTokens);
    return tokens;
  }

  modelUsageStats({todayStart,monthStart}){
    const aggregate=since=>this.db.prepare(`SELECT COUNT(*) AS calls, COUNT(total_tokens) AS metered_calls,
      COALESCE(SUM(total_tokens),0) AS tokens FROM model_usage WHERE occurred_at>=?`).get(since);
    return {today:aggregate(todayStart),month:aggregate(monthStart)};
  }

  setSetting(key, value) {
    this.db.prepare(`INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .run(key, JSON.stringify(value), new Date().toISOString());
    return value;
  }

  bootstrap() {
    return {
      settings: this.getSetting('preferences', {
        language: 'zh-CN', theme: 'system', frequency: 'daily', time: '09:00',
        weekdays: [1,2,3,4,5], retentionMonths: 6, cleanupTime: '03:30', sidebarCollapsed: false, scheduleEnabled: true
      }),
      topics: this.listTopics(),
      reports: this.listReports(),
      trash: this.listTrash(),
      tabs: this.db.prepare('SELECT * FROM open_tabs ORDER BY position').all(),
      models: this.listModels(),
      dataPath: path.dirname(this.file)
    };
  }

  listReports() {
    return this.db.prepare('SELECT * FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC').all()
      .map(row => ({ ...row, is_favorite: Boolean(row.is_favorite) }));
  }

  listTrash() {
    return this.db.prepare('SELECT * FROM reports WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all()
      .map(row => ({ ...row, is_favorite:Boolean(row.is_favorite) }));
  }

  getTopicRevision() { return this.getSetting('topic_revision', 0); }

  bumpTopicRevision() {
    const next = this.getTopicRevision() + 1;
    this.setSetting('topic_revision', next);
    return next;
  }

  listTopics() {
    return this.db.prepare('SELECT * FROM topics ORDER BY position,created_at').all().map(row => ({ ...row, enabled:Boolean(row.enabled) }));
  }

  addTopic({ name, description, min_items=6, region_preference='global' }) {
    const minimum=validateMinimum(min_items);
    if(!['domestic','global'].includes(region_preference))throw new Error('无效的资讯范围 / Invalid search region');
    const title = String(name || '').trim();
    const details = String(description || '').trim();
    if (title.length < 2 || title.length > 80) throw new Error('主题名称需为 2–80 个字符');
    if (details.length < 8 || details.length > 1000) throw new Error('关注描述需为 8–1000 个字符');
    const id = crypto.randomUUID();
    const position = this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS value FROM topics').get().value;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO topics(id,name_zh,name_en,description,enabled,position,created_at,updated_at,min_items,region_preference) VALUES(?,?,?,?,1,?,?,?,?,?)')
      .run(id,title,title,details,position,now,now,minimum,region_preference);
    this.bumpTopicRevision();
    return this.listTopics().find(topic => topic.id === id);
  }

  updateTopic(id, { name, description, min_items, region_preference }) {
    const current = this.db.prepare('SELECT * FROM topics WHERE id=?').get(id);
    if (!current) throw new Error('主题不存在');
    const minimum=validateMinimum(min_items??current.min_items);
    region_preference=region_preference??current.region_preference;
    if(!['domestic','global'].includes(region_preference))throw new Error('无效的资讯范围 / Invalid search region');
    const title = String(name || '').trim();
    const details = String(description || '').trim();
    if (title.length < 2 || title.length > 80) throw new Error('主题名称需为 2–80 个字符');
    if (details.length < 8 || details.length > 1000) throw new Error('关注描述需为 8–1000 个字符');
    this.db.prepare('UPDATE topics SET name_zh=?,name_en=?,description=?,min_items=?,region_preference=?,updated_at=? WHERE id=?')
      .run(title,current.name_zh===title?current.name_en:title,details,minimum,region_preference,new Date().toISOString(),id);
    if(require('./report-snapshot').fingerprint(current)!==require('./report-snapshot').fingerprint({...current,name_zh:title,description:details,min_items:minimum,region_preference}))this.bumpTopicRevision();
    return this.listTopics().find(topic => topic.id === id);
  }

  deleteTopic(id) {
    const result = this.db.prepare('DELETE FROM topics WHERE id=?').run(id);
    if (!result.changes) throw new Error('主题不存在');
    const routes=this.getSetting('topic_routes',{});delete routes[id];this.setSetting('topic_routes',routes);
    this.bumpTopicRevision();
    return { id };
  }

  setTopicEnabled(id, enabled) {
    const current = this.db.prepare('SELECT enabled FROM topics WHERE id=?').get(id);
    const result = this.db.prepare('UPDATE topics SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0,new Date().toISOString(),id);
    if (!result.changes) throw new Error('主题不存在');
    if (Boolean(current.enabled) !== Boolean(enabled)) this.bumpTopicRevision();
    return this.listTopics().find(topic => topic.id === id);
  }

  getReport(id) {
    const row = this.db.prepare('SELECT * FROM reports WHERE id=?').get(id);
    return row ? { ...row, is_favorite: Boolean(row.is_favorite) } : null;
  }
  unreadCount() {return this.db.prepare('SELECT COUNT(*) AS count FROM reports WHERE is_unread=1 AND deleted_at IS NULL').get().count;}
  markUnread(id) {return this.db.prepare('UPDATE reports SET is_unread=1,notified_at=? WHERE id=? AND deleted_at IS NULL AND notified_at IS NULL').run(new Date().toISOString(),id).changes>0;}
  markRead(id) {this.db.prepare('UPDATE reports SET is_unread=0 WHERE id=?').run(id);return this.unreadCount();}

  findDailyReport(date) {
    const row = this.db.prepare("SELECT * FROM reports WHERE report_type='daily' AND period_start=? AND topic_revision=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").get(date,this.getTopicRevision());
    return row ? { ...row, is_favorite: Boolean(row.is_favorite) } : null;
  }

  dailyReports(date) {
    return this.db.prepare("SELECT * FROM reports WHERE report_type='daily' AND period_start=? AND deleted_at IS NULL ORDER BY created_at DESC,rowid DESC").all(date);
  }

  latestDailyReport(date) {
    const row=this.db.prepare("SELECT * FROM reports WHERE report_type='daily' AND period_start=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").get(date);
    return row ? {...row,is_favorite:Boolean(row.is_favorite)} : null;
  }

  insertReport(report) {
    this.db.prepare(`INSERT INTO reports(id,title,report_type,period_start,period_end,html_path,is_favorite,created_at,topic_revision)
      VALUES(?,?,?,?,?,?,0,?,?)`).run(report.id, report.title, report.report_type, report.period_start, report.period_end, report.html_path, report.created_at, report.topic_revision ?? this.getTopicRevision());
    return this.getReport(report.id);
  }

  toggleFavorite(id) {
    const result = this.db.prepare('UPDATE reports SET is_favorite=CASE is_favorite WHEN 1 THEN 0 ELSE 1 END WHERE id=? AND deleted_at IS NULL').run(id);
    if (!result.changes) throw new Error('报告不存在');
    return this.getReport(id);
  }

  markTrashed(id, trashPath, originalPath) {
    this.db.prepare('UPDATE reports SET html_path=?,original_path=?,deleted_at=? WHERE id=? AND deleted_at IS NULL')
      .run(trashPath,originalPath,new Date().toISOString(),id);
    this.db.prepare('DELETE FROM open_tabs WHERE report_id=?').run(id);
    return this.getReport(id);
  }

  markRestored(id, originalPath) {
    this.db.prepare('UPDATE reports SET html_path=?,original_path=NULL,deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL').run(originalPath,id);
    return this.getReport(id);
  }

  permanentlyDeleteReport(id) {
    this.db.prepare('DELETE FROM reports WHERE id=? AND deleted_at IS NOT NULL').run(id);
    return { id };
  }

  saveTabs(tabs) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM open_tabs');
      const insert = this.db.prepare('INSERT INTO open_tabs(tab_id,report_id,title,position,is_active,updated_at) VALUES(?,?,?,?,?,?)');
      tabs.forEach((tab, position) => insert.run(tab.id, tab.reportId || null, tab.title, position, tab.active ? 1 : 0, new Date().toISOString()));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return true;
  }

  listModels() {
    return this.db.prepare('SELECT id,provider,model,base_url,status,is_default,last_verified_at FROM model_profiles ORDER BY is_default DESC,updated_at DESC').all()
      .map(row => ({ ...row, is_default: Boolean(row.is_default) }));
  }

  getDefaultModelRecord() {
    return this.db.prepare("SELECT * FROM model_profiles WHERE is_default=1 AND status='verified' ORDER BY updated_at DESC LIMIT 1").get() || null;
  }

  getModelRecord(id) { return this.db.prepare('SELECT * FROM model_profiles WHERE id=?').get(id) || null; }

  saveVerifiedModel(profile, credentialRef) {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('UPDATE model_profiles SET is_default=0');
      this.db.prepare(`INSERT INTO model_profiles(id,provider,model,base_url,credential_ref,status,is_default,last_verified_at,updated_at)
        VALUES(?,?,?,?,?,'verified',1,?,?)
        ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,
        credential_ref=excluded.credential_ref,status='verified',is_default=1,last_verified_at=excluded.last_verified_at,updated_at=excluded.updated_at`)
        .run(profile.id, profile.provider, profile.model, profile.baseUrl, credentialRef, now, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listModels()[0];
  }

  close() { this.db.close(); }
}

module.exports = { DailyAiDatabase };
