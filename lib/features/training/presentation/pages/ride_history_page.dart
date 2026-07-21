import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/utils/duration_formatter.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/ride_session_record.dart';
import '../providers/ride_history_providers.dart';

class RideHistoryPage extends ConsumerWidget {
  const RideHistoryPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<RideSessionRecord>> sessions = ref.watch(rideSessionsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.rideHistoryTitle)),
      body: SafeArea(
        child: sessions.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stackTrace) => Center(child: Text(l10n.genericErrorMessage)),
          data: (List<RideSessionRecord> records) {
            if (records.isEmpty) {
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
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: records.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (BuildContext context, int index) => _SessionTile(record: records[index]),
            );
          },
        ),
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.record});

  final RideSessionRecord record;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Icon(Icons.directions_bike, color: Theme.of(context).colorScheme.onPrimaryContainer),
        ),
        title: Text(_formatDate(record.startTime)),
        subtitle: Text(
          '${DurationFormatter.format(record.duration)}  ·  '
          '${(record.distanceMeters / 1000).toStringAsFixed(2)} km  ·  '
          '${record.caloriesKcal.round()} kcal',
        ),
        trailing: record.lastPowerWatts != null
            ? Text('${record.lastPowerWatts} W', style: Theme.of(context).textTheme.titleSmall)
            : null,
      ),
    );
  }

  String _formatDate(DateTime date) {
    const List<String> months = <String>[
      'ene', 'feb', 'mar', 'abr', 'may', 'jun', //
      'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
    ];
    return '${date.day} ${months[date.month - 1]} · '
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}
