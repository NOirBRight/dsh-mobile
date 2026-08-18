package top.noirbright.dshmobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Shell-owned storage for credentials that must not enter WebView persistence. */
@CapacitorPlugin(name = "DshSecureVault")
public final class SecureVaultPlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "top.noirbright.dshmobile.secure_vault.v1";
    private static final String PREFERENCES_NAME = "shell_secure_vault";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String REFERENCE_PREFIX = "vault:";
    private static final int REFERENCE_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final int MAX_SECRET_BYTES = 65_536;
    private static final int MAX_ENCODED_SECRET_CHARS = 87_384;
    private static final byte RECORD_VERSION = 1;
    private static final Pattern REFERENCE_PATTERN =
            Pattern.compile("^vault:[A-Za-z0-9_-]{43}$");

    private final SecureRandom secureRandom = new SecureRandom();
    private final Object keyLock = new Object();

    @PluginMethod
    public void storeSecret(PluginCall call) {
        String secretBase64 = call.getString("secretBase64");
        if (secretBase64 == null || secretBase64.isEmpty()) {
            call.reject("A secret is required");
            return;
        }
        if (secretBase64.length() > MAX_ENCODED_SECRET_CHARS) {
            call.reject("Secret is too large");
            return;
        }

        byte[] plaintext;
        try {
            plaintext = Base64.decode(secretBase64, Base64.NO_WRAP);
        } catch (IllegalArgumentException exception) {
            call.reject("Invalid secret encoding");
            return;
        }
        if (plaintext.length == 0) {
            call.reject("A secret is required");
            return;
        }
        if (plaintext.length > MAX_SECRET_BYTES) {
            Arrays.fill(plaintext, (byte) 0);
            call.reject("Secret is too large");
            return;
        }
        try {
            SharedPreferences preferences = preferences();
            for (int attempt = 0; attempt < 4; attempt++) {
                String reference = newReference();
                if (preferences.contains(reference)) {
                    continue;
                }

                String record = encrypt(reference, plaintext);
                if (!preferences.edit().putString(reference, record).commit()) {
                    call.reject("Unable to store secret");
                    return;
                }

                JSObject result = new JSObject();
                result.put("ref", reference);
                call.resolve(result);
                return;
            }
            call.reject("Unable to store secret");
        } catch (GeneralSecurityException | RuntimeException exception) {
            call.reject("Unable to store secret");
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    @PluginMethod
    public void replaceSecret(PluginCall call) {
        String reference = validatedReference(call);
        if (reference == null) {
            return;
        }
        String secretBase64 = call.getString("secretBase64");
        if (secretBase64 == null || secretBase64.isEmpty()) {
            call.reject("A secret is required");
            return;
        }
        if (secretBase64.length() > MAX_ENCODED_SECRET_CHARS) {
            call.reject("Secret is too large");
            return;
        }

        byte[] plaintext;
        try {
            plaintext = Base64.decode(secretBase64, Base64.NO_WRAP);
        } catch (IllegalArgumentException exception) {
            call.reject("Invalid secret encoding");
            return;
        }
        if (plaintext.length == 0 || plaintext.length > MAX_SECRET_BYTES) {
            Arrays.fill(plaintext, (byte) 0);
            call.reject(plaintext.length == 0 ? "A secret is required" : "Secret is too large");
            return;
        }
        try {
            String record = encrypt(reference, plaintext);
            if (!preferences().edit().putString(reference, record).commit()) {
                call.reject("Unable to store secret");
                return;
            }
            call.resolve();
        } catch (GeneralSecurityException | RuntimeException exception) {
            call.reject("Unable to store secret");
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    @PluginMethod
    public void readSecret(PluginCall call) {
        String reference = validatedReference(call);
        if (reference == null) {
            return;
        }

        byte[] plaintext = null;
        try {
            String record = preferences().getString(reference, null);
            if (record == null) {
                call.resolve(new JSObject());
                return;
            }
            plaintext = decrypt(reference, record);
            JSObject result = new JSObject();
            result.put("secretBase64", Base64.encodeToString(plaintext, Base64.NO_WRAP));
            call.resolve(result);
        } catch (GeneralSecurityException | RuntimeException exception) {
            call.reject("Unable to read secret");
        } finally {
            if (plaintext != null) {
                Arrays.fill(plaintext, (byte) 0);
            }
        }
    }

    @PluginMethod
    public void deleteSecret(PluginCall call) {
        String reference = validatedReference(call);
        if (reference == null) {
            return;
        }

        try {
            SharedPreferences preferences = preferences();
            boolean existed = preferences.contains(reference);
            if (existed && !preferences.edit().remove(reference).commit()) {
                call.reject("Unable to delete secret");
                return;
            }

            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Unable to delete secret");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private String validatedReference(PluginCall call) {
        String reference = call.getString("ref");
        if (reference == null || !REFERENCE_PATTERN.matcher(reference).matches()) {
            call.reject("A valid secret reference is required");
            return null;
        }
        return reference;
    }

    private String newReference() {
        byte[] randomBytes = new byte[REFERENCE_BYTES];
        secureRandom.nextBytes(randomBytes);
        try {
            return REFERENCE_PREFIX + encode(randomBytes);
        } finally {
            Arrays.fill(randomBytes, (byte) 0);
        }
    }

    private String encrypt(String reference, byte[] plaintext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        cipher.updateAAD(reference.getBytes(StandardCharsets.US_ASCII));
        byte[] ciphertext = cipher.doFinal(plaintext);
        byte[] iv = cipher.getIV();

        if (iv == null || iv.length != IV_BYTES) {
            Arrays.fill(ciphertext, (byte) 0);
            throw new GeneralSecurityException("Unexpected cipher parameters");
        }

        ByteBuffer record = ByteBuffer.allocate(1 + IV_BYTES + ciphertext.length);
        record.put(RECORD_VERSION);
        record.put(iv);
        record.put(ciphertext);
        Arrays.fill(ciphertext, (byte) 0);
        return encode(record.array());
    }

    private byte[] decrypt(String reference, String encodedRecord) throws GeneralSecurityException {
        byte[] record = decode(encodedRecord);
        try {
            if (record.length <= 1 + IV_BYTES || record[0] != RECORD_VERSION) {
                throw new GeneralSecurityException("Invalid vault record");
            }

            byte[] iv = Arrays.copyOfRange(record, 1, 1 + IV_BYTES);
            byte[] ciphertext = Arrays.copyOfRange(record, 1 + IV_BYTES, record.length);
            try {
                Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
                cipher.updateAAD(reference.getBytes(StandardCharsets.US_ASCII));
                return cipher.doFinal(ciphertext);
            } finally {
                Arrays.fill(iv, (byte) 0);
                Arrays.fill(ciphertext, (byte) 0);
            }
        } finally {
            Arrays.fill(record, (byte) 0);
        }
    }

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        synchronized (keyLock) {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            try {
                keyStore.load(null);
            } catch (IOException exception) {
                throw new GeneralSecurityException("Unable to load keystore", exception);
            }
            java.security.Key existingKey = keyStore.getKey(KEY_ALIAS, null);
            if (existingKey instanceof SecretKey) {
                return (SecretKey) existingKey;
            }

            KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    KEYSTORE_PROVIDER
            );
            generator.init(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return generator.generateKey();
        }
    }

    private static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static byte[] decode(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
}
