import { describe, it, expect } from 'vitest';
import { assertConnectionString } from '../src/db/client.js';

const OK = 'postgresql://postgres.abc123:s3cret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

describe('连接串前置校验（把报错说人话）', () => {
  it('合法连接串通过', () => {
    expect(() => assertConnectionString(OK)).not.toThrow();
    expect(() => assertConnectionString(OK.replace('postgresql', 'postgres'))).not.toThrow();
  });

  it('⭐ 只贴了密码 → 明确告诉他该去哪儿复制，而不是 Invalid URL 堆栈', () => {
    expect(() => assertConnectionString('MyR3setPassw0rd')).toThrow(/不是连接串.*Session pooler/s);
  });

  it('占位符没替换 → 点名 [YOUR-PASSWORD]', () => {
    expect(() => assertConnectionString(OK.replace('s3cret', '[YOUR-PASSWORD]')))
      .toThrow(/\[YOUR-PASSWORD\] 占位符/);
  });

  it('缺密码 → 明说没密码', () => {
    expect(() => assertConnectionString('postgresql://postgres@host:5432/postgres'))
      .toThrow(/没有密码/);
  });

  // 注：密码里多一个 @ 其实能正常解析（URL 取最后一个 @ 作分隔符），
  // 检测不出来也不该假装能检测。只在真正解析失败时提示百分号编码。
  it('不过度校验：主机名奇怪但结构完整的串照样放行', () => {
    expect(() => assertConnectionString('postgresql://u:p@localhost:5432/db')).not.toThrow();
  });
});
