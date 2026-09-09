// `CollectionReference`/`DocumentReference`/`DocumentSnapshot` de
// `cloud_firestore` son `sealed` en la versión fijada en `pubspec.lock`
// — el patrón `Mock`+`implements` (mocktail) siempre dispara este aviso
// del analizador sobre un tipo sellado, sin alternativa dentro de las
// dependencias ya declaradas (agregar `fake_cloud_firestore` sería una
// dependencia nueva, fuera de alcance de esta tarea).
// ignore_for_file: subtype_of_sealed_class

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:rouvy_pro/features/auth/data/models/user_model.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';

class MockFirebaseAuth extends Mock implements FirebaseAuth {}

class MockGoogleSignIn extends Mock implements GoogleSignIn {}

class MockFirebaseFirestore extends Mock implements FirebaseFirestore {}

class MockCollectionReference extends Mock implements CollectionReference<Map<String, dynamic>> {}

class MockDocumentReference extends Mock implements DocumentReference<Map<String, dynamic>> {}

class MockDocumentSnapshot extends Mock implements DocumentSnapshot<Map<String, dynamic>> {}

class MockUserCredential extends Mock implements UserCredential {}

class MockUser extends Mock implements User {}

class _FakeAuthProvider extends Fake implements AuthProvider {}

/// KORIXA-WEB-GOOGLE-FIREBASE-POPUP-POC-20260908.
///
/// `flutter test` corre siempre sobre la VM (`kIsWeb` es `false` ahí sin
/// excepción) — igual que en `resolveGoogleSignInClientId` y en
/// `GoogleSignInButton`, `debugIsWeb` en el constructor de
/// `AuthRemoteDataSourceImpl` deja forzar cada rama sin compilar/correr
/// en Chrome de verdad. Cubre lo que el encargo pide probar directo:
/// en Web, `signInWithGoogle()` llama a `FirebaseAuth.signInWithPopup`
/// (nunca a `GoogleSignIn().signIn()`), y en Android/iOS sigue
/// exactamente al revés.
void main() {
  setUpAll(() {
    registerFallbackValue(_FakeAuthProvider());
  });

  late MockFirebaseAuth firebaseAuth;
  late MockGoogleSignIn googleSignIn;
  late MockFirebaseFirestore firestore;
  late MockCollectionReference usersCollection;
  late MockDocumentReference userDoc;
  late MockDocumentSnapshot userSnapshot;
  late MockUserCredential userCredential;
  late MockUser firebaseUser;

  setUp(() {
    firebaseAuth = MockFirebaseAuth();
    googleSignIn = MockGoogleSignIn();
    firestore = MockFirebaseFirestore();
    usersCollection = MockCollectionReference();
    userDoc = MockDocumentReference();
    userSnapshot = MockDocumentSnapshot();
    userCredential = MockUserCredential();
    firebaseUser = MockUser();

    when(() => firestore.collection('users')).thenReturn(usersCollection);
    when(() => usersCollection.doc(any())).thenReturn(userDoc);
    when(() => userDoc.get()).thenAnswer((_) async => userSnapshot);
    when(() => userDoc.set(any())).thenAnswer((_) async {});
    when(() => userSnapshot.exists).thenReturn(false);

    when(() => firebaseUser.uid).thenReturn('uid-1');
    when(() => firebaseUser.email).thenReturn('rider@ridepro.com');
    when(() => firebaseUser.displayName).thenReturn('Rider');
    when(() => firebaseUser.photoURL).thenReturn(null);
    when(() => firebaseUser.emailVerified).thenReturn(true);

    when(() => userCredential.user).thenReturn(firebaseUser);
    when(() => firebaseAuth.signInWithPopup(any())).thenAnswer((_) async => userCredential);
  });

  group('signInWithGoogle — Web (debugIsWeb: true)', () {
    late AuthRemoteDataSourceImpl datasource;

    setUp(() {
      datasource = AuthRemoteDataSourceImpl(
        firebaseAuth: firebaseAuth,
        firestore: firestore,
        googleSignIn: googleSignIn,
        debugIsWeb: true,
      );
    });

    test('llama a FirebaseAuth.signInWithPopup(GoogleAuthProvider) y nunca a GoogleSignIn().signIn()',
        () async {
      await datasource.signInWithGoogle();

      verify(() => firebaseAuth.signInWithPopup(any(that: isA<GoogleAuthProvider>()))).called(1);
      verifyNever(() => googleSignIn.signIn());
    });

    test('entrega el User de Firebase devuelto por el popup al flujo existente de alta/lectura en Firestore',
        () async {
      final UserModel result = await datasource.signInWithGoogle();

      expect(result.id, 'uid-1');
      expect(result.providerType, AuthProviderType.google);
      verify(() => userDoc.set(any())).called(1);
    });

    test('lanza AuthException si el popup se cierra sin completar (sin User)', () async {
      when(() => userCredential.user).thenReturn(null);

      expect(datasource.signInWithGoogle(), throwsA(isA<AuthException>()));
    });

    test('propaga FirebaseAuthException (p. ej. popup-closed-by-user) sin capturarla', () async {
      when(() => firebaseAuth.signInWithPopup(any()))
          .thenThrow(FirebaseAuthException(code: 'popup-closed-by-user'));

      expect(
        datasource.signInWithGoogle(),
        throwsA(isA<FirebaseAuthException>().having((e) => e.code, 'code', 'popup-closed-by-user')),
      );
    });
  });

  group('signInWithGoogle — Nativo (debugIsWeb: false)', () {
    late AuthRemoteDataSourceImpl datasource;

    setUp(() {
      datasource = AuthRemoteDataSourceImpl(
        firebaseAuth: firebaseAuth,
        firestore: firestore,
        googleSignIn: googleSignIn,
        debugIsWeb: false,
      );
    });

    test('sigue llamando a GoogleSignIn().signIn() y nunca a FirebaseAuth.signInWithPopup', () async {
      when(() => googleSignIn.signIn()).thenAnswer((_) async => null);

      await expectLater(datasource.signInWithGoogle(), throwsA(isA<AuthException>()));

      verify(() => googleSignIn.signIn()).called(1);
      verifyNever(() => firebaseAuth.signInWithPopup(any()));
    });
  });
}
