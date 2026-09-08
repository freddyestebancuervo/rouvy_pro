import 'package:equatable/equatable.dart';

import 'telemetry_source.dart';

/// Estado normalizado de una métrica arbitrada.
class TelemetryMetricState<T> extends Equatable {
  const TelemetryMetricState({
    required this.value,
    required this.source,
    required this.sourceId,
    required this.observedAt,
    required this.priority,
    required this.freshnessWindow,
  });

  final T value;
  final TelemetrySourceKind source;
  final String sourceId;
  final DateTime observedAt;
  final int priority;
  final Duration freshnessWindow;

  DateTime get expiresAt => observedAt.add(freshnessWindow);

  bool isFreshAt(DateTime now) => !now.isAfter(expiresAt);

  @override
  List<Object?> get props => [value, source, sourceId, observedAt, priority, freshnessWindow];
}
