import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/network/network_info.dart';

class MockConnectivity extends Mock implements Connectivity {}

void main() {
  late MockConnectivity connectivity;
  late NetworkInfoImpl networkInfo;

  setUp(() {
    connectivity = MockConnectivity();
    networkInfo = NetworkInfoImpl(connectivity);
  });

  group('isConnected', () {
    test('true cuando hay al menos un tipo de conexión activo', () async {
      when(() => connectivity.checkConnectivity())
          .thenAnswer((_) async => <ConnectivityResult>[ConnectivityResult.wifi]);

      expect(await networkInfo.isConnected, isTrue);
    });

    test('false cuando el único resultado es "none"', () async {
      when(() => connectivity.checkConnectivity())
          .thenAnswer((_) async => <ConnectivityResult>[ConnectivityResult.none]);

      expect(await networkInfo.isConnected, isFalse);
    });
  });

  group('onConnectivityChanged', () {
    test('mapea la lista de resultados de connectivity_plus a un bool', () async {
      when(() => connectivity.onConnectivityChanged).thenAnswer(
        (_) => Stream<List<ConnectivityResult>>.fromIterable(<List<ConnectivityResult>>[
          <ConnectivityResult>[ConnectivityResult.wifi],
          <ConnectivityResult>[ConnectivityResult.none],
          <ConnectivityResult>[ConnectivityResult.mobile],
        ]),
      );

      final List<bool> emitted = await networkInfo.onConnectivityChanged.toList();

      expect(emitted, <bool>[true, false, true]);
    });
  });
}
