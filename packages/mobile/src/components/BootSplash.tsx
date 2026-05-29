import React, { useEffect, useRef } from 'react';
import {
  View, Text, Image, StyleSheet, Animated, Easing, Dimensions, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path, Rect, Circle, G, Defs, LinearGradient, Stop,
} from 'react-native-svg';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const BRAND = {
  navy: '#02209D',
  teal: '#02CDBA',
  ivory: '#F8FAFC',
  text: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  yellow: '#FACC15',
};

/**
 * Busync 부팅 스플래시.
 *  - 아이보리 배경 + 가로형 lockup
 *  - 한국어 카피
 *  - 하단: 버스 경로 모티브의 로딩바 (곡선을 따라 카툰 버스가 진행)
 */
export default function BootSplash() {
  const insets = useSafeAreaInsets();
  const { width: SW } = Dimensions.get('window');

  // ── 인트로 페이드인 ───────────────────────────
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introLift = useRef(new Animated.Value(8)).current;

  // ── 곡선 진행 (0..1) ─────────────────────────
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {
        toValue: 1, duration: 420,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(introLift, {
        toValue: 0, duration: 480,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();

    // 한 사이클 = 4초. progress 가 SVG 속성(translate/rotation/dashOffset)에
    // 바인딩되므로 네이티브 드라이버는 사용할 수 없다(JS 드라이버 필수).
    Animated.timing(progress, {
      toValue: 1,
      duration: 4000,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [introOpacity, introLift, progress]);

  // SVG viewBox 320×120 — 좌하 → 우상 웨이브
  const startX = 18,  startY = 92;
  const c1X = 110,    c1Y = 116;
  const c2X = 210,    c2Y = 6;
  const endX = 300,   endY = 38;
  const pathD = `M ${startX} ${startY} C ${c1X} ${c1Y}, ${c2X} ${c2Y}, ${endX} ${endY}`;

  // 3차 베지어 — 위치/접선각
  const bezierPoint = (t: number) => {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * startX + 3 * mt * mt * t * c1X + 3 * mt * t * t * c2X + t * t * t * endX,
      y: mt * mt * mt * startY + 3 * mt * mt * t * c1Y + 3 * mt * t * t * c2Y + t * t * t * endY,
    };
  };
  const bezierAngle = (t: number) => {
    const mt = 1 - t;
    const dx = 3 * mt * mt * (c1X - startX) + 6 * mt * t * (c2X - c1X) + 3 * t * t * (endX - c2X);
    const dy = 3 * mt * mt * (c1Y - startY) + 6 * mt * t * (c2Y - c1Y) + 3 * t * t * (endY - c2Y);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };

  const samples = Array.from({ length: 31 }, (_, i) => i / 30);
  const xs = samples.map((t) => bezierPoint(t).x);
  const ys = samples.map((t) => bezierPoint(t).y);
  const angles = samples.map((t) => bezierAngle(t));

  const busX = progress.interpolate({ inputRange: samples, outputRange: xs });
  const busY = progress.interpolate({ inputRange: samples, outputRange: ys });
  const busAngle = progress.interpolate({ inputRange: samples, outputRange: angles });

  // 곡선의 "지나온 길" 강조 — strokeDashoffset 으로 그려나가는 효과
  // 전체 길이 추정 (러프 적분)
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const p0 = bezierPoint(samples[i - 1]);
    const p1 = bezierPoint(samples[i]);
    total += Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }
  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [total, 0],
  });

  const SVG_W = SW - 48;
  const SVG_H = (SVG_W * 120) / 320;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Animated.View
        style={[
          styles.topBlock,
          { opacity: introOpacity, transform: [{ translateY: introLift }] },
        ]}
      >
        <Image
          source={require('../../assets/busync-lockup-transparent.png')}
          style={styles.lockup}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />

        <View style={styles.copyBlock}>
          <Text style={styles.headline}>
            기사님,{'\n'}오늘도 안전 운행{'\n'}하세요.
          </Text>
          <Text style={styles.subhead}>
            배차 · 휴무 · 대타까지 모든 일정을{'\n'}한 곳에서 관리하세요.
          </Text>
        </View>
      </Animated.View>

      {/* ── 하단 로딩바: 버스 경로 모티브 ─────────── */}
      <View style={styles.loaderWrap}>
        <Svg width={SVG_W} height={SVG_H} viewBox="0 0 320 120">
          <Defs>
            <LinearGradient id="curve" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={BRAND.teal} stopOpacity="0.5" />
              <Stop offset="1" stopColor={BRAND.teal} stopOpacity="1" />
            </LinearGradient>
          </Defs>

          {/* 배경 가이드 (옅은 점선) */}
          <Path
            d={pathD}
            stroke={BRAND.teal}
            strokeOpacity={0.18}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            strokeDasharray="2 6"
          />

          {/* 진행한 길 (실선, 점차 그려짐) */}
          <AnimatedPath
            d={pathD}
            stroke="url(#curve)"
            strokeWidth={3.6}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={total}
            strokeDashoffset={dashOffset}
          />

          {/* 출발 정류장 */}
          <Circle cx={startX} cy={startY} r={6} fill="#FFFFFF" stroke={BRAND.teal} strokeWidth={2.4} />

          {/* 도착 정류장 */}
          <Circle cx={endX} cy={endY} r={6} fill="#FFFFFF" stroke={BRAND.navy} strokeWidth={2.4} />

          {/* 곡선을 따라 진행하는 카툰 버스 */}
          <AnimatedG
            translateX={busX as unknown as number}
            translateY={busY as unknown as number}
            rotation={busAngle as unknown as number}
            originX={0}
            originY={0}
          >
            <BusGlyph />
          </AnimatedG>
        </Svg>
      </View>

      {/* 푸터 */}
      <View style={styles.footer}>
        <View style={styles.footerSide} />
        <View style={styles.footerRight}>
          <View style={styles.dot} />
          <Text style={styles.footerText}>준비 중…</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * 404 일러스트 톤의 미니 카툰 버스.
 * 좌표는 자체 로컬 (-21,-16 ~ +21,+10) — translate(0,0) 기준 중심에 가깝게.
 */
function BusGlyph() {
  return (
    <G transform="translate(-21,-15)">
      {/* 그림자 */}
      <Rect x="3" y="22.5" width="37" height="2.6" rx="1.3" fill="#0F172A" opacity="0.10" />
      {/* 차체 */}
      <Rect x="2" y="3" width="36" height="19" rx="5.5" fill={BRAND.navy} />
      {/* 앞 유리 */}
      <Rect x="5.5" y="6.5" width="11" height="9" rx="2" fill="#FFFFFF" />
      {/* 중간 창 */}
      <Rect x="18.5" y="6.5" width="8" height="9" rx="1.5" fill="#FFFFFF" />
      {/* 뒷 창 */}
      <Rect x="28.5" y="6.5" width="6.5" height="9" rx="1.5" fill="#FFFFFF" />
      {/* 헤드라이트 (눈) */}
      <Circle cx="7" cy="18.5" r="1.7" fill={BRAND.yellow} />
      <Circle cx="11" cy="18.5" r="1.7" fill={BRAND.yellow} />
      {/* teal 사이드 스트라이프 */}
      <Rect x="3" y="20" width="34" height="1.2" fill={BRAND.teal} opacity="0.9" />
      {/* 바퀴 */}
      <Circle cx="11" cy="23.4" r="2.3" fill={BRAND.navy} />
      <Circle cx="11" cy="23.4" r="0.9" fill="#FFFFFF" />
      <Circle cx="30" cy="23.4" r="2.3" fill={BRAND.navy} />
      <Circle cx="30" cy="23.4" r="0.9" fill="#FFFFFF" />
    </G>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND.ivory,
    paddingHorizontal: 24,
  },

  topBlock: {
    marginTop: 32,
  },
  lockup: {
    width: '82%',
    height: 92,
    alignSelf: 'center',
  },
  copyBlock: {
    marginTop: 40,
  },
  headline: {
    fontSize: 28,
    fontWeight: '800',
    color: BRAND.text,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  subhead: {
    marginTop: 16,
    fontSize: 14.5,
    fontWeight: '500',
    color: BRAND.textMuted,
    lineHeight: 22,
  },

  loaderWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Platform.select({ ios: 4, android: 16 }),
  },
  footerSide: { width: 80 },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND.teal,
  },
  footerText: {
    fontSize: 12,
    color: BRAND.textMuted,
    fontWeight: '500',
  },
});
