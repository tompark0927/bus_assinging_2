const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// npm workspaces 모노레포 설정 (Expo 공식 가이드).
// admin-web 은 react 18, mobile 은 react 19 를 사용한다.
// 루트에 호이스팅된 공유 패키지(@tanstack/react-query, react-i18next, zustand 등)가
// 계층 탐색으로 루트의 react@18 을 집어 오면 "Invalid hook call" 로 즉사하므로,
// 계층 탐색을 끄고 mobile → 루트 순서로만 해석하게 강제한다.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
