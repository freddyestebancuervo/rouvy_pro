import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/utils/duration_formatter.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/statistics_summary.dart';
import '../providers/statistics_providers.dart';
import '../widgets/weekly_bar_chart.dart';

class StatisticsPage extends ConsumerWidget {
  const StatisticsPage({super.key});

  static const List<String> _spanishDayLetters = <String>['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  static const List<String> _spanishFullDayNames = <String>[
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<StatisticsSummary> summaryState = ref.watch(statisticsSummaryProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.statisticsTitle)),
      body: SafeArea(
        child: summaryState.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stackTrace) => Center(child: Text(l10n.genericErrorMessage)),
          data: (StatisticsSummary summary) {
            if (summary.totalSessions == 0) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    l10n.noSessionsYetMessage,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Theme.of(context).colorScheme.outline),
                  ),
                ),
              );
            }

            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      if (summary.currentStreakDays > 0) _StreakBanner(days: summary.currentStreakDays, l10n: l10n),
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: <Widget>[
                              _TotalStat(
                                label: l10n.metricDistanceLabel,
                                value: '${(summary.totalDistanceMeters / 1000).toStringAsFixed(0)} km',
                              ),
                              _TotalStat(
                                label: l10n.metricTimeLabel,
                                value: DurationFormatter.format(Duration(seconds: summary.totalDurationSeconds)),
                              ),
                              _TotalStat(
                                label: l10n.metricCaloriesLabel,
                                value: '${summary.totalCaloriesKcal.round()}',
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(l10n.weeklyActivityLabel, style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: WeeklyBarChart(
                            valuesKm: summary.dailyDistanceLast7Days.map((double m) => m / 1000).toList(),
                            dayLabels: _lastSevenDayLabels(),
                            fullDayNames: _lastSevenFullDayNames(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(l10n.personalRecordsLabel, style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 12),
                      Card(
                        child: ListTile(
                          leading: Icon(Icons.emoji_events_outlined, color: Theme.of(context).colorScheme.primary),
                          title: Text(l10n.longestSessionLabel),
                          trailing: Text(
                            '${(summary.longestSessionDistanceMeters / 1000).toStringAsFixed(1)} km',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.totalSessionsLabel(summary.totalSessions),
                        textAlign: TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Theme.of(context).colorScheme.outline),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  /// Etiquetas de los últimos 7 días terminando hoy, en el mismo orden
  /// que `StatisticsSummary.dailyDistanceLast7Days` (índice 6 = hoy).
  List<String> _lastSevenDayLabels() {
    final DateTime today = DateTime.now();
    return List<String>.generate(7, (int i) {
      final DateTime day = today.subtract(Duration(days: 6 - i));
      return _spanishDayLetters[day.weekday - 1]; // weekday: 1=lunes..7=domingo
    });
  }

  /// Igual que arriba, pero con el nombre completo — usado solo para la
  /// etiqueta semántica del gráfico (`WeeklyBarChart.fullDayNames`), no
  /// se muestra visualmente (ahí se sigue usando la letra corta).
  List<String> _lastSevenFullDayNames() {
    final DateTime today = DateTime.now();
    return List<String>.generate(7, (int i) {
      final DateTime day = today.subtract(Duration(days: 6 - i));
      return _spanishFullDayNames[day.weekday - 1];
    });
  }
}

class _StreakBanner extends StatelessWidget {
  const _StreakBanner({required this.days, required this.l10n});

  final int days;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.local_fire_department, color: Colors.deepOrange),
          const SizedBox(width: 10),
          Expanded(child: Text(l10n.streakLabel(days), style: Theme.of(context).textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

class _TotalStat extends StatelessWidget {
  const _TotalStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
