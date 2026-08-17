import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/features/workouts/data/datasources/workouts_remote_datasource.dart';

class MockDio extends Mock implements Dio {}

/// JSON mínimo válido para `WorkoutModel.fromJson` — `id`/`createdAt`
/// son los únicos campos que estos tests necesitan variar.
Map<String, dynamic> _workoutJson(
  String id, {
  bool isMine = true,
  String createdAt = '2026-01-10T08:00:00.000Z',
}) =>
    <String, dynamic>{
      'id': id,
      'name': 'Workout $id',
      'description': null,
      'sport': 'cycling',
      'estimatedDurationSeconds': 1800,
      'targetType': 'power',
      'isPublic': false,
      'isMine': isMine,
      'archivedAt': null,
      'createdAt': createdAt,
      'updatedAt': createdAt,
    };

Response<dynamic> _pageResponse(
  List<Map<String, dynamic>> items, {
  String? nextCursor,
  String headerName = 'X-Next-Cursor',
}) {
  return Response<dynamic>(
    requestOptions: RequestOptions(path: '/workouts'),
    statusCode: 200,
    data: items,
    headers: Headers.fromMap(
      nextCursor == null
          ? const <String, List<String>>{}
          : <String, List<String>>{
              headerName: <String>[nextCursor],
            },
    ),
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/workouts'));
  });

  late MockDio dio;
  late WorkoutsRemoteDataSourceImpl datasource;
  late List<Map<String, dynamic>> capturedQueries;

  setUp(() {
    dio = MockDio();
    datasource = WorkoutsRemoteDataSourceImpl(dio);
    capturedQueries = <Map<String, dynamic>>[];
  });

  /// Programa las respuestas que el mock de Dio devuelve EN ORDEN, una
  /// por llamada a `GET /workouts`, capturando los `queryParameters`
  /// reales de cada llamada para poder auditarlos después (filtros,
  /// `limit`, `cursor`).
  void stubPages(List<Response<dynamic>> pages) {
    var call = 0;
    when(
      () => dio.get<dynamic>(
        any(),
        queryParameters: any(named: 'queryParameters'),
      ),
    ).thenAnswer((Invocation invocation) async {
      final Map<String, dynamic> query = Map<String, dynamic>.from(
        invocation.namedArguments[#queryParameters] as Map<String, dynamic>,
      );
      capturedQueries.add(query);
      final Response<dynamic> page = pages[call];
      call += 1;
      return page;
    });
  }

  group('una sola página', () {
    test('sin X-Next-Cursor: una sola request, lista completa, orden intacto',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(<Map<String, dynamic>>[
          _workoutJson('w1'),
          _workoutJson('w2'),
          _workoutJson('w3'),
        ]),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(capturedQueries, hasLength(1));
      expect(result.map((w) => w.id).toList(), <String>['w1', 'w2', 'w3']);
    });
  });

  group('colección vacía', () {
    test('[] sin cursor: una request, lista vacía, sin error', () async {
      stubPages(<Response<dynamic>>[_pageResponse(<Map<String, dynamic>>[])]);

      final result = await datasource.fetchAll(mineOnly: true);

      expect(capturedQueries, hasLength(1));
      expect(result, isEmpty);
    });
  });

  group('varias páginas', () {
    test('100 + 100 + 5 = 205 elementos exactos, sin truncar', () async {
      final page1 = List<Map<String, dynamic>>.generate(
        100,
        (i) => _workoutJson('p1-$i'),
      );
      final page2 = List<Map<String, dynamic>>.generate(
        100,
        (i) => _workoutJson('p2-$i'),
      );
      final page3 = List<Map<String, dynamic>>.generate(
        5,
        (i) => _workoutJson('p3-$i'),
      );
      stubPages(<Response<dynamic>>[
        _pageResponse(page1, nextCursor: 'cursor-1'),
        _pageResponse(page2, nextCursor: 'cursor-2'),
        _pageResponse(page3),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(capturedQueries, hasLength(3));
      expect(result, hasLength(205));
    });

    test(
        'no omisiones: la secuencia final de IDs es exactamente la esperada, no solo el length',
        () async {
      final expectedIds = <String>[
        for (int i = 0; i < 120; i++) 'id-$i',
      ];
      final page1 = expectedIds.sublist(0, 100).map(_workoutJson).toList();
      final page2 = expectedIds.sublist(100).map(_workoutJson).toList();
      stubPages(<Response<dynamic>>[
        _pageResponse(page1, nextCursor: 'cursor-a'),
        _pageResponse(page2),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(result.map((w) => w.id).toList(), expectedIds);
    });

    test('no duplicados: dataset correcto produce cada ID exactamente una vez',
        () async {
      final ids = List<String>.generate(150, (i) => 'unique-$i');
      final page1 = ids.sublist(0, 100).map(_workoutJson).toList();
      final page2 = ids.sublist(100).map(_workoutJson).toList();
      stubPages(<Response<dynamic>>[
        _pageResponse(page1, nextCursor: 'c1'),
        _pageResponse(page2),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(result.map((w) => w.id).toSet(), hasLength(150));
    });

    test('orden exacto: page1 items seguidos de page2 items, sin resort',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[
            _workoutJson('z-first', createdAt: '2026-06-01T00:00:00.000Z'),
            _workoutJson('a-second', createdAt: '2026-05-01T00:00:00.000Z'),
          ],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[
          _workoutJson('m-third', createdAt: '2026-04-01T00:00:00.000Z'),
        ]),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      // Orden alfabético/temporal deliberadamente "desordenado" para
      // demostrar que NO se aplica ningún sort() local — el resultado
      // debe ser exactamente el orden de llegada del servidor.
      expect(
        result.map((w) => w.id).toList(),
        <String>['z-first', 'a-second', 'm-third'],
      );
    });

    test(
        'empates de createdAt en la frontera de página: el orden del servidor se preserva sin cambios',
        () async {
      const String tiedTimestamp = '2026-07-01T00:00:00.000Z';
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[
            _workoutJson('tie-b', createdAt: tiedTimestamp),
            _workoutJson('tie-a', createdAt: tiedTimestamp),
          ],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[
          _workoutJson('tie-c', createdAt: tiedTimestamp),
        ]),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(
        result.map((w) => w.id).toList(),
        <String>['tie-b', 'tie-a', 'tie-c'],
      );
    });
  });

  group('duplicado entre páginas (error de protocolo)', () {
    test(
        'mismo ID en page1 y page2 lanza ServerException, no dedupe silencioso',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('dup-id')],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('dup-id')]),
      ]);

      await expectLater(
        datasource.fetchAll(mineOnly: false),
        throwsA(isA<ServerException>()),
      );
    });
  });

  group('cursor repetido (protección de loop infinito)', () {
    test(
        'X-Next-Cursor repetido entre páginas lanza ServerException con número finito de requests',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('r1')],
          nextCursor: 'same-cursor',
        ),
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('r2')],
          nextCursor: 'same-cursor',
        ),
      ]);

      await expectLater(
        datasource.fetchAll(mineOnly: false),
        throwsA(isA<ServerException>()),
      );
      // Se detuvo tras la segunda respuesta (cursor repetido detectado
      // ahí mismo) — nunca intentó una tercera request.
      expect(capturedQueries, hasLength(2));
    });
  });

  group('cursor opaco', () {
    test(
        'el valor del cursor se reenvía EXACTO (con caracteres que requieren encoding), sin decode/re-encode',
        () async {
      const String opaqueCursor = 'eyJ2IjoxLCJmIjoiYWJjMTIzIn0=+/test';
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('o1')],
          nextCursor: opaqueCursor,
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('o2')]),
      ]);

      await datasource.fetchAll(mineOnly: false);

      expect(capturedQueries[1]['cursor'], opaqueCursor);
    });
  });

  group('workouts — mine preservado', () {
    test('mineOnly=true: "mine"="true" idéntico en todas las páginas',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('m1')],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('m2')]),
      ]);

      await datasource.fetchAll(mineOnly: true);

      for (final query in capturedQueries) {
        expect(query['mine'], 'true');
      }
    });

    test(
        'mineOnly=false: "mine" ausente (mismo criterio legacy) en todas las páginas',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('f1')],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('f2')]),
      ]);

      await datasource.fetchAll(mineOnly: false);

      for (final query in capturedQueries) {
        expect(query.containsKey('mine'), isFalse);
      }
    });
  });

  group('limit', () {
    test('cada request incluye explícitamente limit=100', () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('l1')],
          nextCursor: 'c1',
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('l2')]),
      ]);

      await datasource.fetchAll(mineOnly: false);

      for (final query in capturedQueries) {
        expect(query['limit'], '100');
      }
    });
  });

  group('header normalizado (case-insensitive)', () {
    test(
        'header emitido en minúsculas (x-next-cursor) se detecta igual que X-Next-Cursor',
        () async {
      stubPages(<Response<dynamic>>[
        _pageResponse(
          <Map<String, dynamic>>[_workoutJson('h1')],
          nextCursor: 'lowercase-cursor',
          headerName: 'x-next-cursor',
        ),
        _pageResponse(<Map<String, dynamic>>[_workoutJson('h2')]),
      ]);

      final result = await datasource.fetchAll(mineOnly: false);

      expect(capturedQueries, hasLength(2));
      expect(result.map((w) => w.id).toList(), <String>['h1', 'h2']);
    });
  });
}
