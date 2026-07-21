import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/utils/validation_l10n.dart';
import '../../../../core/utils/validators.dart';
import '../../../../core/widgets/app_primary_button.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../providers/forgot_password_controller.dart';

class ForgotPasswordPage extends ConsumerStatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  ConsumerState<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends ConsumerState<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _linkSent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final bool success =
        await ref.read(forgotPasswordControllerProvider.notifier).submit(_emailController.text.trim());

    if (!mounted) return;
    if (success) setState(() => _linkSent = true);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<void> state = ref.watch(forgotPasswordControllerProvider);

    ref.listen<AsyncValue<void>>(forgotPasswordControllerProvider, (previous, next) {
      if (next.hasError && !next.isLoading) {
        final Object error = next.error!;
        final String message = error is Failure ? error.message : l10n.genericErrorMessage;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      }
    });

    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: _linkSent ? _buildConfirmation(context, l10n) : _buildForm(context, l10n, state),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildForm(BuildContext context, AppLocalizations l10n, AsyncValue<void> state) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l10n.forgotPasswordTitle, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 8),
          Text(
            l10n.forgotPasswordSubtitle,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.outline),
          ),
          const SizedBox(height: 28),
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(labelText: l10n.emailLabel),
            onFieldSubmitted: (_) => _handleSubmit(),
            validator: (String? value) => Validators.email(value).message(l10n),
          ),
          const SizedBox(height: 20),
          AppPrimaryButton(
            label: l10n.sendResetLinkButton,
            isLoading: state.isLoading,
            onPressed: _handleSubmit,
          ),
        ],
      ),
    );
  }

  Widget _buildConfirmation(BuildContext context, AppLocalizations l10n) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(Icons.mark_email_read_outlined, size: 64, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 20),
        Text(
          l10n.resetLinkSentMessage,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 24),
        TextButton(
          onPressed: () => context.pop(),
          child: Text(l10n.backToLoginLink),
        ),
      ],
    );
  }
}
