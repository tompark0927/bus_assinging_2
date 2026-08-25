const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// npm workspaces 모노레포 설정.
// admin-web 은 react 18, mobile 은 react 19 를 사용한다.
// 루트에 호이스팅된 공유 패키지(@tanstack/react-query, react-i18next, zustand 등)가
// 계층 탐색으로 루트의 react@18 을 집어 오면 이중 React 로 "Invalid hook call" 크래시가
// 나므로, react / react-native 계열 "싱글턴"만 mobile 쪽 사본으로 강제 리다이렉트한다.
// (disableHierarchicalLookup 방식은 expo/node_modules/expo-asset 같은
//  중첩 패키지 해석을 전부 깨뜨려서 사용 불가 — EAS Bundle JS 단계 실패 원인이었음)
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

// 정확히 이 바이너리에 링크된 네이티브/싱글턴 패키지만 고정한다.
// 'react-native-svg' 처럼 접두사만 같은 패키지를 오인하지 않도록
// 「정확 일치 또는 'name/' 서브패스」만 매칭한다.
const SINGLETONS = ['react', 'react-native'];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const hit = SINGLETONS.find(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  if (hit) {
    // mobile 의 index.js 에서 import 한 것처럼 해석 → packages/mobile/node_modules 우선
    const ctx = {
      ...context,
      originModulePath: path.join(projectRoot, 'index.js'),
    };
    return (defaultResolveRequest ?? context.resolveRequest)(ctx, moduleName, platform);
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
