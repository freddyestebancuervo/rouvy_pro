import '../../domain/entities/training_route.dart';

/// Catálogo fijo de 7 rutas — hoy es la ÚNICA fuente de datos de este
/// módulo (no hay Firestore ni backend real todavía para rutas). Cuando
/// se implemente uno real, este archivo se sustituye por un datasource
/// que sí llame a esa fuente, sin tocar `RoutesRepository` ni ninguna
/// capa por encima.
///
/// KORIXA-MVP-VERTICAL-SLICE-01 — de las 7, 6 (`RouteContentType.video`/
/// `terrain3d`) siguen siendo únicamente etiquetas descriptivas de un
/// futuro módulo M4 (sin video ni 3D real detrás, ver el docblock de
/// `RouteContentType`). La séptima (`route-mvp-local-loop`,
/// `RouteContentType.staticRoute`) es la única que este slice usa para
/// probar una ride real de principio a fin — no reclama ningún contenido
/// audiovisual ni geográfico verificado, solo una distancia fija.
abstract class RoutesMockDataSource {
  static List<TrainingRoute> fetchAll() => _catalog;

  static TrainingRoute? fetchById(String id) {
    for (final TrainingRoute route in _catalog) {
      if (route.id == id) return route;
    }
    return null;
  }

  static const List<TrainingRoute> _catalog = <TrainingRoute>[
    TrainingRoute(
      id: 'route-alpe-dhuez',
      name: "Alpe d'Huez",
      distanceMeters: 13800,
      elevationGainMeters: 1071,
      difficulty: RouteDifficulty.extreme,
      contentType: RouteContentType.video,
      locationName: 'Francia',
      descriptionEs:
          'Las 21 curvas legendarias del Tour de Francia. Una subida exigente '
          'con pendientes sostenidas de 8-10% — clásico para quien quiera '
          'medirse contra un mito del ciclismo.',
      descriptionEn:
          'The legendary 21 hairpin turns of the Tour de France. A demanding '
          'climb with sustained 8-10% gradients — a classic for anyone who '
          'wants to test themselves against a cycling legend.',
    ),
    TrainingRoute(
      id: 'route-flat-valley',
      name: 'Valle Llano',
      distanceMeters: 25000,
      elevationGainMeters: 120,
      difficulty: RouteDifficulty.easy,
      contentType: RouteContentType.terrain3d,
      descriptionEs:
          'Ruta 3D generada por terreno, ideal para calentar o para sesiones '
          'de resistencia de baja intensidad — prácticamente sin desnivel.',
      descriptionEn:
          'Procedurally generated 3D route, ideal for warming up or low '
          'intensity endurance sessions — virtually no elevation gain.',
    ),
    TrainingRoute(
      id: 'route-coastal-loop',
      name: 'Costa del Sol',
      distanceMeters: 42000,
      elevationGainMeters: 380,
      difficulty: RouteDifficulty.moderate,
      contentType: RouteContentType.video,
      locationName: 'España',
      descriptionEs:
          'Recorrido costero grabado en video con subidas cortas y vistas al '
          'mar — buen equilibrio entre exigencia y disfrute del paisaje.',
      descriptionEn:
          'Video-recorded coastal route with short climbs and ocean views — '
          'a good balance between challenge and scenery.',
    ),
    TrainingRoute(
      id: 'route-mountain-pass',
      name: 'Paso de Montaña',
      distanceMeters: 31000,
      elevationGainMeters: 890,
      difficulty: RouteDifficulty.hard,
      contentType: RouteContentType.terrain3d,
      descriptionEs:
          'Terreno 3D con un puerto de montaña completo — pendiente variable '
          'entre 4% y 9%, con un tramo final de descenso técnico.',
      descriptionEn:
          '3D terrain with a full mountain pass — variable gradient between '
          '4% and 9%, with a technical descent at the end.',
    ),
    TrainingRoute(
      id: 'route-city-crit',
      name: 'Criterium Urbano',
      distanceMeters: 8000,
      elevationGainMeters: 45,
      difficulty: RouteDifficulty.moderate,
      contentType: RouteContentType.terrain3d,
      descriptionEs:
          'Circuito corto y plano ideal para intervalos de alta intensidad o '
          'práctica de sprints — se puede repetir varias veces seguidas.',
      descriptionEn:
          'Short, flat circuit ideal for high-intensity intervals or sprint '
          'practice — can be repeated several times in a row.',
    ),
    TrainingRoute(
      id: 'route-sunday-recovery',
      name: 'Recuperación de Domingo',
      distanceMeters: 18000,
      elevationGainMeters: 60,
      difficulty: RouteDifficulty.easy,
      contentType: RouteContentType.video,
      locationName: 'Países Bajos',
      descriptionEs:
          'Video de un paseo tranquilo por zonas rurales llanas — pensado '
          'para días de recuperación activa, sin exigencia física real.',
      descriptionEn:
          'Video of a calm ride through flat rural areas — designed for '
          'active recovery days, with no real physical demand.',
    ),
    TrainingRoute(
      id: 'route-mvp-local-loop',
      name: 'Vuelta de prueba MVP',
      distanceMeters: 3000,
      elevationGainMeters: 0,
      difficulty: RouteDifficulty.easy,
      contentType: RouteContentType.staticRoute,
      descriptionEs:
          'Ruta local de prueba del Route-First MVP: solo distancia fija '
          '(3 km, sin desnivel real medido). Sin video ni terreno 3D — '
          'sirve para probar de punta a punta que la app rastrea tu '
          'progreso real (telemetría → distancia → % de ruta) mientras '
          'pedaleás, no para representar un lugar ni un paisaje real.',
      descriptionEn:
          'Local test route for the Route-First MVP: fixed distance only '
          '(3 km, no real elevation measured). No video, no 3D terrain — '
          'it exists to prove the app tracks your real progress '
          '(telemetry → distance → route %) while you ride, not to '
          'represent an actual place or scenery.',
    ),
  ];
}
