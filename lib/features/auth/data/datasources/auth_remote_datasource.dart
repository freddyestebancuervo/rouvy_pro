import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../../../../core/error/exceptions.dart';
import '../../domain/entities/user_entity.dart';
import '../models/user_model.dart';

/// Única capa autorizada a llamar directamente a los SDKs de Firebase,
/// Google Sign-In y Sign in with Apple. Si mañana se migra de proveedor,
/// solo este archivo (y su implementación) cambia — el resto de la app no
/// se entera.
abstract class AuthRemoteDataSource {
  Future<UserModel> login({required String email, required String password});

  Future<UserModel> register({
    required String email,
    required String password,
    required String displayName,
  });

  Future<UserModel> signInWithGoogle();

  Future<UserModel> signInWithApple();

  Future<void> logout();

  Future<UserModel?> getCurrentUser();

  Stream<UserModel?> get authStateChanges;

  Future<void> sendPasswordResetEmail(String email);

  Future<void> sendEmailVerification();

  Future<UserModel?> reloadCurrentUser();

  Future<UserModel> updateProfile({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
  });
}

class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  AuthRemoteDataSourceImpl({
    required fb.FirebaseAuth firebaseAuth,
    required FirebaseFirestore firestore,
    required GoogleSignIn googleSignIn,
  })  : _firebaseAuth = firebaseAuth,
        _firestore = firestore,
        _googleSignIn = googleSignIn;

  final fb.FirebaseAuth _firebaseAuth;
  final FirebaseFirestore _firestore;
  final GoogleSignIn _googleSignIn;

  static const String _usersCollection = 'users';

  // -------------------------------------------------------------------
  // Correo y contraseña
  // -------------------------------------------------------------------

  @override
  Future<UserModel> login({
    required String email,
    required String password,
  }) async {
    final fb.UserCredential credential =
        await _firebaseAuth.signInWithEmailAndPassword(email: email, password: password);
    final fb.User? firebaseUser = credential.user;
    if (firebaseUser == null) {
      throw const AuthException('No se pudo iniciar sesión.');
    }
    return _fetchUserDocument(firebaseUser, AuthProviderType.password);
  }

  @override
  Future<UserModel> register({
    required String email,
    required String password,
    required String displayName,
  }) async {
    final fb.UserCredential credential =
        await _firebaseAuth.createUserWithEmailAndPassword(email: email, password: password);
    final fb.User? firebaseUser = credential.user;
    if (firebaseUser == null) {
      throw const AuthException('No se pudo crear la cuenta.');
    }

    await firebaseUser.updateDisplayName(displayName);
    // Se envía automáticamente el correo de verificación al registrarse —
    // el flujo de la pantalla de verificación ofrece reenviarlo también.
    await firebaseUser.sendEmailVerification();

    final UserModel newUser = UserModel(
      id: firebaseUser.uid,
      email: email,
      displayName: displayName,
      emailVerified: false,
      providerType: AuthProviderType.password,
    );

    await _firestore.collection(_usersCollection).doc(firebaseUser.uid).set(newUser.toMap());

    return newUser;
  }

  // -------------------------------------------------------------------
  // Login social
  // -------------------------------------------------------------------

  @override
  Future<UserModel> signInWithGoogle() async {
    final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
    if (googleUser == null) {
      // El usuario cerró el selector de cuentas — no es un error real.
      throw const AuthException('Inicio de sesión cancelado.', code: 'sign-in-cancelled');
    }

    final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
    final fb.AuthCredential credential = fb.GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );

    final fb.UserCredential userCredential = await _firebaseAuth.signInWithCredential(credential);
    final fb.User? firebaseUser = userCredential.user;
    if (firebaseUser == null) {
      throw const AuthException('No se pudo iniciar sesión con Google.');
    }

    return _fetchOrCreateSocialUser(firebaseUser, AuthProviderType.google);
  }

  @override
  Future<UserModel> signInWithApple() async {
    // Apple exige un nonce aleatorio hasheado con SHA-256 por seguridad
    // (previene ataques de repetición del token de identidad).
    final String rawNonce = _generateNonce();
    final String hashedNonce = sha256.convert(utf8.encode(rawNonce)).toString();

    final AuthorizationCredentialAppleID appleCredential = await SignInWithApple.getAppleIDCredential(
      scopes: <AppleIDAuthorizationScopes>[
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
      nonce: hashedNonce,
    );

    final fb.OAuthCredential credential = fb.OAuthProvider('apple.com').credential(
      idToken: appleCredential.identityToken,
      rawNonce: rawNonce,
    );

    final fb.UserCredential userCredential = await _firebaseAuth.signInWithCredential(credential);
    final fb.User? firebaseUser = userCredential.user;
    if (firebaseUser == null) {
      throw const AuthException('No se pudo iniciar sesión con Apple.');
    }

    // Apple solo entrega el nombre la PRIMERA vez que el usuario autoriza
    // la app — hay que capturarlo aquí porque no volverá a llegar.
    final String? appleFullName = <String?>[appleCredential.givenName, appleCredential.familyName]
        .where((String? part) => part != null && part.isNotEmpty)
        .join(' ')
        .trim()
        .let((String v) => v.isEmpty ? null : v);

    if (appleFullName != null && (firebaseUser.displayName == null || firebaseUser.displayName!.isEmpty)) {
      await firebaseUser.updateDisplayName(appleFullName);
    }

    return _fetchOrCreateSocialUser(firebaseUser, AuthProviderType.apple);
  }

  // -------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------

  @override
  Future<void> logout() async {
    await Future.wait<void>([
      _firebaseAuth.signOut(),
      _googleSignIn.signOut(),
    ]);
  }

  @override
  Future<UserModel?> getCurrentUser() async {
    final fb.User? firebaseUser = _firebaseAuth.currentUser;
    if (firebaseUser == null) return null;
    return _fetchUserDocument(firebaseUser, _inferProviderType(firebaseUser));
  }

  @override
  Stream<UserModel?> get authStateChanges {
    return _firebaseAuth.authStateChanges().asyncMap((fb.User? user) async {
      if (user == null) return null;
      return _fetchUserDocument(user, _inferProviderType(user));
    });
  }

  // -------------------------------------------------------------------
  // Recuperación de contraseña
  // -------------------------------------------------------------------

  @override
  Future<void> sendPasswordResetEmail(String email) {
    return _firebaseAuth.sendPasswordResetEmail(email: email);
  }

  // -------------------------------------------------------------------
  // Verificación de correo
  // -------------------------------------------------------------------

  @override
  Future<void> sendEmailVerification() async {
    final fb.User? user = _firebaseAuth.currentUser;
    if (user == null) throw const AuthException('No hay una sesión activa.');
    await user.sendEmailVerification();
  }

  @override
  Future<UserModel?> reloadCurrentUser() async {
    final fb.User? user = _firebaseAuth.currentUser;
    if (user == null) return null;
    await user.reload();
    // Tras `reload()`, `_firebaseAuth.currentUser` referencia el objeto
    // actualizado con el `emailVerified` fresco.
    final fb.User? refreshed = _firebaseAuth.currentUser;
    if (refreshed == null) return null;
    return _fetchUserDocument(refreshed, _inferProviderType(refreshed));
  }

  // -------------------------------------------------------------------
  // Perfil
  // -------------------------------------------------------------------

  @override
  Future<UserModel> updateProfile({
    String? displayName,
    String? photoUrl,
    int? ftp,
    double? weightKg,
  }) async {
    final fb.User? user = _firebaseAuth.currentUser;
    if (user == null) throw const AuthException('No hay una sesión activa.');

    if (displayName != null) await user.updateDisplayName(displayName);
    if (photoUrl != null) await user.updatePhotoURL(photoUrl);

    final Map<String, dynamic> updates = <String, dynamic>{
      if (displayName != null) 'displayName': displayName,
      if (photoUrl != null) 'photoUrl': photoUrl,
      if (ftp != null) 'ftp': ftp,
      if (weightKg != null) 'weightKg': weightKg,
    };
    if (updates.isNotEmpty) {
      await _firestore.collection(_usersCollection).doc(user.uid).set(
            updates,
            SetOptions(merge: true),
          );
    }

    return _fetchUserDocument(user, _inferProviderType(user));
  }

  // -------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------

  AuthProviderType _inferProviderType(fb.User user) {
    if (user.providerData.any((fb.UserInfo info) => info.providerId == 'google.com')) {
      return AuthProviderType.google;
    }
    if (user.providerData.any((fb.UserInfo info) => info.providerId == 'apple.com')) {
      return AuthProviderType.apple;
    }
    return AuthProviderType.password;
  }

  Future<UserModel> _fetchUserDocument(fb.User firebaseUser, AuthProviderType providerType) async {
    final DocumentSnapshot<Map<String, dynamic>> doc =
        await _firestore.collection(_usersCollection).doc(firebaseUser.uid).get();

    if (!doc.exists || doc.data() == null) {
      final UserModel fallback = UserModel(
        id: firebaseUser.uid,
        email: firebaseUser.email ?? '',
        displayName: firebaseUser.displayName ?? '',
        photoUrl: firebaseUser.photoURL,
        emailVerified: firebaseUser.emailVerified,
        providerType: providerType,
      );
      await _firestore.collection(_usersCollection).doc(firebaseUser.uid).set(fallback.toMap());
      return fallback;
    }

    return UserModel.fromMap(
      doc.data()!,
      doc.id,
      emailVerified: firebaseUser.emailVerified,
      providerType: providerType,
    );
  }

  /// Crea el documento de Firestore en el primer login social; en logins
  /// posteriores simplemente lo lee (comportamiento tipo "upsert").
  Future<UserModel> _fetchOrCreateSocialUser(fb.User firebaseUser, AuthProviderType providerType) async {
    final DocumentReference<Map<String, dynamic>> ref =
        _firestore.collection(_usersCollection).doc(firebaseUser.uid);
    final DocumentSnapshot<Map<String, dynamic>> doc = await ref.get();

    if (!doc.exists) {
      final UserModel newUser = UserModel(
        id: firebaseUser.uid,
        email: firebaseUser.email ?? '',
        displayName: firebaseUser.displayName ?? '',
        photoUrl: firebaseUser.photoURL,
        emailVerified: true, // proveedores sociales ya verifican el correo
        providerType: providerType,
      );
      await ref.set(newUser.toMap());
      return newUser;
    }

    return UserModel.fromMap(
      doc.data()!,
      doc.id,
      emailVerified: true,
      providerType: providerType,
    );
  }

  String _generateNonce([int length = 32]) {
    const String charset =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
    final Random random = Random.secure();
    return List<String>.generate(length, (_) => charset[random.nextInt(charset.length)]).join();
  }
}

/// Pequeño helper de extensión al estilo Kotlin `let`, solo para legibilidad
/// en la construcción del nombre completo de Apple.
extension _Let<T> on T {
  R let<R>(R Function(T) block) => block(this);
}
