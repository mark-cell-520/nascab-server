import 'package:flutter/foundation.dart';

/// Web 端反代子路径前缀：地址栏 `https://host/nascab/` → `'/nascab/'`，
/// 部署在根路径时 → `''`。
///
/// 与 `ApiController._getDefaultBaseUrl`、`video_platform_web._webP2pBasePath`
/// 同一套约定：Flutter Web 是 hash 路由，`Uri.base.path` 恒等于 `<base href>`
/// 的路径，不随导航变化（本机构建产物 `web/main/index.html` 里是
/// `<base href="/nascab/">`）。
///
/// WebSocket 的 path 必须带上这个前缀。改造前 `resolveFileWsBaseUri` /
/// `getTerminalConnectUrl` 都只取 `scheme://host:port`，再
/// `replace(path: '/api/...')`，于是实际连的是 `wss://host/api/...`——
/// 落在反代站点根路径上，被 nginx 的 `location /` 转去了另一个服务
/// （本机是 9119），表现成"连上就断、目录永不自动刷新、终端毫无反应"。
String webBasePathPrefix() {
  if (!kIsWeb) return '';
  var p = Uri.base.path;
  if (p.isEmpty || p == '/') return '';
  if (!p.endsWith('/')) p = '$p/';
  return p;
}

/// 把 `'/api/file/watch'` 这类绝对 API 路径拼到 base 路径后面。
/// base 为空（根路径部署 / 非 Web）时结果与传入值逐字节一致。
String joinWsPath(String basePath, String apiPath) {
  final rel = apiPath.startsWith('/') ? apiPath.substring(1) : apiPath;
  final base = basePath.trim();
  if (base.isEmpty || base == '/') return '/$rel';
  final withSlash = base.endsWith('/') ? base : '$base/';
  return '$withSlash$rel';
}
