import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Asset } from 'expo-asset';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import game from './assets/game/index.html';

const IMPACT: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};
const NOTIFY: Record<string, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};
// The SMG fires 11 shots a second; buzzing on every one feels like a broken phone.
const HAPTIC_GAP_MS = 70;

export default function App() {
  useKeepAwake();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastBuzz = useRef(0);

  useEffect(() => {
    Asset.fromModule(game)
      .downloadAsync()
      .then((a) => setUri(a.localUri ?? a.uri))
      .catch((e) => setError(String(e)));
  }, []);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { t?: string; k?: string };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.t !== 'haptic' || !msg.k) return;
    const now = Date.now();
    if (now - lastBuzz.current < HAPTIC_GAP_MS) return;
    lastBuzz.current = now;
    if (IMPACT[msg.k]) Haptics.impactAsync(IMPACT[msg.k]).catch(() => {});
    else if (NOTIFY[msg.k]) Haptics.notificationAsync(NOTIFY[msg.k]).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {uri ? (
        <WebView
          style={styles.root}
          source={{ uri }}
          originWhitelist={['*']}
          // the game is one file in the app's cache folder
          allowFileAccess
          allowingReadAccessToURL={uri.slice(0, uri.lastIndexOf('/') + 1)}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          bounces={false}
          overScrollMode="never"
          scrollEnabled={false}
          setBuiltInZoomControls={false}
          textZoom={100}
          webviewDebuggingEnabled={__DEV__}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(r) => r.url.startsWith('file:') || r.url === 'about:blank'}
        />
      ) : (
        <View style={styles.center}>
          {error ? <Text style={styles.error}>Could not load the game: {error}</Text> : <ActivityIndicator color="#5fe0ff" size="large" />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07020f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#fff', textAlign: 'center', fontSize: Platform.OS === 'ios' ? 15 : 14 },
});
