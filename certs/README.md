# 额外信任的根证书

## letsencrypt-root-yr-by-x1.pem

**为什么需要**：晚点 LatePost 的证书由 Let's Encrypt 2025 年的新中间证书 `YR1` 签发，
而 `YR1` 的根是 `ISRG Root YR`——Node 24 自带的 CA 列表和 macOS 钥匙串都还没收录它。
Node 直接报 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`，curl 能通是因为它会自动补链。

**这不是安全妥协**：
- 用的是**交叉签名版本**（`root-yr-by-x1.pem`），由 Node 已经信任的 `ISRG Root X1` 签发，
  等于走已有信任链，不是凭空加一个陌生的新根。
- 证书校验**全程开着**。我们没有用 `NODE_TLS_REJECT_UNAUTHORIZED=0`
  或任何按域名放行的手段——那才是真正的妥协，而且会掩盖将来真实的证书问题。

**来源**：https://letsencrypt.org/certs/gen-y/root-yr-by-x1.pem（官网 HTTPS 取，2026-08-29）

```
subject  C=US, O=ISRG, CN=Root YR
issuer   C=US, O=Internet Security Research Group, CN=ISRG Root X1
有效期    2026-05-13 → 2032-09-02
SHA256   07:26:39:D0:B1:40:D5:BF:FA:E1:6A:D9:C3:F6:CC:60:86:04:06:21:F5:1E:E6:1A:6D:46:A8:91:5C:07:CF:76
```

**什么时候可以删掉**：等 Node 的 CA 列表收录 ISRG Root YR 之后。
判断方法：不带 `NODE_EXTRA_CA_CERTS` 跑 `tools/chkCerts.ts`，能通就说明不需要了。
