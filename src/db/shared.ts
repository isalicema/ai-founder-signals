import { createDatabaseConnection, type DatabaseConnection } from './client';

/**
 * 网页进程共用的数据库连接池。
 *
 * ⚠️ 为什么必须共用：原先 loadFeed / applyFeedAction 每次请求都
 *    create → query → close。数据库在新加坡，还要走代理出去，
 *    每次请求都重新做 TCP + TLS 握手——**实测首字节 23.7 秒**。
 *    对一个「30 秒扫完」的产品，光加载就 24 秒是致命的。
 *
 * 用 globalThis 缓存是为了扛住 Next 开发模式的模块热重载，
 * 否则每次改代码都会泄漏一个连接池。
 */
const KEY = Symbol.for('afs.db.shared');
type Holder = { conn?: DatabaseConnection };
const holder = ((globalThis as Record<symbol, unknown>)[KEY] ??= {} as Holder) as Holder;

export function sharedDb(): DatabaseConnection {
  holder.conn ??= createDatabaseConnection({ maxConnections: 5 });
  return holder.conn;
}
