package uts.sdk.modules.familyFileExport;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import android.util.Base64OutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Reads selected photos and app-private drafts without FileReader/Data URL bridging. */
public final class LocalFileReader {
    private LocalFileReader() {}

    public static String readBase64(String path, Context context) throws IOException {
        try (InputStream input = open(path, context);
             ByteArrayOutputStream encoded = new ByteArrayOutputStream()) {
            try (OutputStream encoder = new Base64OutputStream(encoded, Base64.NO_WRAP)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    encoder.write(buffer, 0, count);
                }
            }
            if (encoded.size() == 0) throw new IOException("EMPTY_LOCAL_FILE");
            return encoded.toString("US-ASCII");
        }
    }

    private static InputStream open(String path, Context context) throws IOException {
        if (path == null || path.isEmpty()) throw new IOException("INVALID_LOCAL_FILE");
        Uri uri = Uri.parse(path);
        String scheme = uri.getScheme();
        if ("content".equalsIgnoreCase(scheme)) {
            // Use the access granted by the system picker; no broad gallery permission.
            InputStream input = context.getContentResolver().openInputStream(uri);
            if (input == null) throw new IOException("LOCAL_FILE_UNAVAILABLE");
            return input;
        }
        String filePath = path;
        if ("file".equalsIgnoreCase(scheme)) {
            filePath = uri.getPath();
        } else if (scheme != null) {
            throw new IOException("UNSUPPORTED_LOCAL_FILE");
        }
        if (filePath == null || !filePath.startsWith("/")) throw new IOException("INVALID_LOCAL_FILE");
        return new FileInputStream(filePath);
    }
}
