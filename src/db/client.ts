import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

export type AfsDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: AfsDatabase;
  sql: Sql;
  close: () => Promise<void>;
}

export interface DatabaseConnectionOptions {
  connectionString?: string;
  maxConnections?: number;
}

/**
 * 连接串的前置校验。
 *
 * 不校验的话，把密码而不是完整连接串贴进 SUPABASE_DB_URL 会得到一句
 * `TypeError: Invalid URL` 加一大段 postgres 内部堆栈——完全看不出该改什么。
 * 这种错误信息的成本全在下一个踩坑的人身上。
 */
export function assertConnectionString(value: string): void {
  const trimmed = value.trim();
  if (!/^postgres(ql)?:\/\//.test(trimmed)) {
    throw new Error(
      'SUPABASE_DB_URL 不是连接串。它应该以 postgresql:// 开头、形如\n' +
      '  postgresql://postgres.<项目ref>:<密码>@<主机>.pooler.supabase.com:5432/postgres\n' +
      '常见原因：只贴了密码。请到 Supabase 控制台 → Project Settings → Database →\n' +
      'Connection string → Session pooler，整行复制，再把 [YOUR-PASSWORD] 换成密码。',
    );
  }
  // ⚠️ 占位符检查必须在 new URL() 之前——URL 会把方括号百分号编码成 %5B%5D，
  //    解析之后就查不到字面的 [ 了
  if (/\[YOUR-PASSWORD\]|\[your-password\]/i.test(trimmed)) {
    throw new Error('SUPABASE_DB_URL 里的密码仍是 [YOUR-PASSWORD] 占位符，需要替换成真实密码。');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('SUPABASE_DB_URL 解析失败。若密码含 @ : / ? # 等字符，需要按 URL 百分号编码。');
  }
  if (!url.password) {
    throw new Error('SUPABASE_DB_URL 里没有密码——连接串中的 [YOUR-PASSWORD] 还没替换。');
  }
}

/**
 * Server/worker-only connection. `prepare: false` is compatible with Supabase's
 * transaction pooler; callers own the lifecycle and must call close().
 */
export function createDatabaseConnection(options: DatabaseConnectionOptions = {}): DatabaseConnection {
  const connectionString = options.connectionString ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('SUPABASE_DB_URL is required');
  assertConnectionString(connectionString);

  const sql = postgres(connectionString, {
    max: options.maxConnections ?? 5,
    prepare: false,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end(),
  };
}
