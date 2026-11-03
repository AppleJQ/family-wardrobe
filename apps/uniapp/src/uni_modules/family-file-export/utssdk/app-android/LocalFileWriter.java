package uts.sdk.modules.familyFileExport;

import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Keeps decoded byte arrays on the Java side of the bridge. */
public final class LocalFileWriter {
    private LocalFileWriter() {}

    public static void writeBase64(String path, String base64) throws IOException {
        if (path == null || !path.startsWith("/") || base64 == null) {
            throw new IOException("INVALID_LOCAL_FILE");
        }
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (bytes.length == 0) throw new IOException("EMPTY_LOCAL_FILE");
        File file = new File(path);
        File parent = file.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory())) {
            throw new IOException("LOCAL_DIRECTORY_UNAVAILABLE");
        }
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            output.flush();
        }
        if (file.length() != bytes.length) throw new IOException("INCOMPLETE_LOCAL_FILE");
    }
}
