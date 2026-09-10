import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:rouvy_pro/core/ble/ble_permission_policy.dart';

void main() {
  group('evaluateBlePermissionStatus', () {
    group('Android API >= 31 (location never required)', () {
      test('Android 35 scan+connect granted, location denied => granted', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 35,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.denied,
          ),
          BlePermissionStatus.granted,
        );
      });

      test(
          'Android 31 scan+connect granted, location permanentlyDenied => granted',
          () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 31,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.permanentlyDenied,
            bluetoothStatus: PermissionStatus.permanentlyDenied,
          ),
          BlePermissionStatus.granted,
        );
      });

      test('Android 35 scan denied => denied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 35,
            scanStatus: PermissionStatus.denied,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.denied,
        );
      });

      test('Android 35 scan permanentlyDenied => permanentlyDenied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 35,
            scanStatus: PermissionStatus.permanentlyDenied,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.permanentlyDenied,
        );
      });

      test('Android 35 connect denied => denied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 35,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.denied,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.denied,
        );
      });
    });

    group('Android API <= 30 (legacy location-gated)', () {
      test('Android 30 location granted => granted', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 30,
            scanStatus: PermissionStatus.denied,
            connectStatus: PermissionStatus.denied,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.denied,
          ),
          BlePermissionStatus.granted,
        );
      });

      test('Android 30 location denied => denied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 30,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.denied,
        );
      });

      test('Android 30 location permanentlyDenied => permanentlyDenied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 30,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.permanentlyDenied,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.permanentlyDenied,
        );
      });

      test('Android 26 location granted => granted (legacy preserved)', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 26,
            scanStatus: PermissionStatus.restricted,
            connectStatus: PermissionStatus.restricted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.restricted,
          ),
          BlePermissionStatus.granted,
        );
      });

      test('Android 26 location denied => denied (legacy preserved)', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 26,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.denied,
        );
      });

      test('unknown SDK falls back to legacy rule', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: null,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.granted,
        );
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: null,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.denied,
        );
      });
    });

    group('iOS (Bluetooth permission only)', () {
      test('bluetooth granted, location denied => granted', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: false,
            isIOS: true,
            androidSdkInt: null,
            scanStatus: PermissionStatus.denied,
            connectStatus: PermissionStatus.denied,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.granted,
          ),
          BlePermissionStatus.granted,
        );
      });

      test('bluetooth denied => denied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: false,
            isIOS: true,
            androidSdkInt: null,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.denied,
          ),
          BlePermissionStatus.denied,
        );
      });

      test('bluetooth permanentlyDenied => permanentlyDenied', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: false,
            isIOS: true,
            androidSdkInt: null,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.permanentlyDenied,
          ),
          BlePermissionStatus.permanentlyDenied,
        );
      });

      test('bluetooth restricted => denied (non-granted)', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: false,
            isIOS: true,
            androidSdkInt: null,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.restricted,
          ),
          BlePermissionStatus.denied,
        );
      });
    });

    group('irrelevant permissions never downgrade', () {
      test('Android 35: irrelevant denied bluetooth/location do not block',
          () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 35,
            scanStatus: PermissionStatus.granted,
            connectStatus: PermissionStatus.granted,
            locationStatus: PermissionStatus.denied,
            bluetoothStatus: PermissionStatus.denied,
          ),
          BlePermissionStatus.granted,
        );
      });

      test('Android 30: irrelevant denied scan/connect do not block', () {
        expect(
          evaluateBlePermissionStatus(
            isAndroid: true,
            isIOS: false,
            androidSdkInt: 30,
            scanStatus: PermissionStatus.denied,
            connectStatus: PermissionStatus.permanentlyDenied,
            locationStatus: PermissionStatus.granted,
            bluetoothStatus: PermissionStatus.denied,
          ),
          BlePermissionStatus.granted,
        );
      });
    });
  });
}
