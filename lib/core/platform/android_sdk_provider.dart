import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Exposes Android `Build.VERSION.SDK_INT` to Dart without adding a
/// third-party dependency (see `MainActivity.kt`, channel
/// `korixa.app/android_sdk`).
///
/// Returns `null` on non-Android platforms and on any channel failure —
/// callers must treat `null` as "unknown SDK" and fall back to the
/// legacy-safe permission rule, never as modern-Android proof.
abstract class AndroidSdkProvider {
  Future<int?> getAndroidSdkInt();
}

class MethodChannelAndroidSdkProvider implements AndroidSdkProvider {
  const MethodChannelAndroidSdkProvider({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('korixa.app/android_sdk');

  final MethodChannel _channel;

  @override
  Future<int?> getAndroidSdkInt() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return null;
    }
    try {
      return await _channel.invokeMethod<int>('getSdkInt');
    } on Exception {
      return null;
    }
  }
}
