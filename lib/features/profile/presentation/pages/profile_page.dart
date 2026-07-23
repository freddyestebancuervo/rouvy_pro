import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/validation_l10n.dart';
import '../../../../core/utils/validators.dart';
import '../../../../core/widgets/app_primary_button.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../auth/domain/entities/user_entity.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../auth/presentation/providers/logout_controller.dart';
import '../../../auth/presentation/providers/profile_controller.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<UserEntity?> authState = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileTitle)),
      body: authState.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object error, StackTrace stackTrace) => Center(child: Text(l10n.genericErrorMessage)),
        data: (UserEntity? user) {
          if (user == null) return const SizedBox.shrink();
          return _ProfileBody(user: user);
        },
      ),
    );
  }
}

class _ProfileBody extends ConsumerStatefulWidget {
  const _ProfileBody({required this.user});

  final UserEntity user;

  @override
  ConsumerState<_ProfileBody> createState() => _ProfileBodyState();
}

class _ProfileBodyState extends ConsumerState<_ProfileBody> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _ftpController;
  late final TextEditingController _weightController;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.user.displayName);
    _ftpController = TextEditingController(text: widget.user.ftp?.toString() ?? '');
    _weightController = TextEditingController(text: widget.user.weightKg?.toString() ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _ftpController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  Future<void> _handleSave(AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;

    final bool success = await ref.read(profileControllerProvider.notifier).updateProfile(
          displayName: _nameController.text.trim(),
          ftp: int.tryParse(_ftpController.text),
          weightKg: double.tryParse(_weightController.text),
        );

    if (!mounted) return;
    if (success) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.profileUpdatedMessage)));
    }
  }

  Future<void> _confirmLogout(AppLocalizations l10n) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.logoutConfirmTitle),
        content: Text(l10n.logoutConfirmMessage),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancelAction),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.confirmAction),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await ref.read(logoutControllerProvider.notifier).logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> profileState = ref.watch(profileControllerProvider);

    ref.listen<AsyncValue<void>>(profileControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) {
        final Object error = next.error!;
        final String message = error is Failure ? error.message : l10n.genericErrorMessage;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      }
    });

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Center(
                child: Column(
                  children: <Widget>[
                    CircleAvatar(
                      radius: 44,
                      backgroundImage:
                          widget.user.photoUrl != null ? NetworkImage(widget.user.photoUrl!) : null,
                      child: widget.user.photoUrl == null
                          ? Text(
                              widget.user.displayName.isNotEmpty
                                  ? widget.user.displayName[0].toUpperCase()
                                  : '?',
                              style: Theme.of(context).textTheme.headlineMedium,
                            )
                          : null,
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () {}, // TODO: subir foto vía Firebase Storage + image_picker
                      child: Text(l10n.changePhotoAction),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(l10n.editProfileTitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              TextFormField(
                controller: _nameController,
                decoration: InputDecoration(labelText: l10n.nameLabel),
                validator: (String? value) => Validators.name(value).message(l10n),
              ),
              const SizedBox(height: 16),
              TextFormField(
                initialValue: widget.user.email,
                enabled: false, // el correo no se edita aquí (requiere reautenticación)
                decoration: InputDecoration(labelText: l10n.emailLabel),
              ),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TextFormField(
                      controller: _ftpController,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(labelText: l10n.ftpLabel),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextFormField(
                      controller: _weightController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(labelText: l10n.weightLabel),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              AppPrimaryButton(
                label: l10n.saveChangesButton,
                isLoading: profileState.isLoading,
                onPressed: () => _handleSave(l10n),
              ),
              const SizedBox(height: 32),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.fitness_center_outlined),
                title: Text(l10n.workoutsTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.workouts),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.bluetooth),
                title: Text(l10n.manageDevicesMenuLabel),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.devices),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.watch),
                title: Text(l10n.wearablesTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.wearables),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.history),
                title: Text(l10n.rideHistoryTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.rideHistory),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.bar_chart),
                title: Text(l10n.statisticsTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.statistics),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.emoji_events_outlined),
                title: Text(l10n.achievementsTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.achievements),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.settings_outlined),
                title: Text(l10n.settingsTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(AppRoute.settings),
              ),
              const SizedBox(height: 8),
              Text(l10n.accountSectionTitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.logout),
                title: Text(l10n.logoutAction),
                onTap: () => _confirmLogout(l10n),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
