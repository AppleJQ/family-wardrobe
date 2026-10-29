package uts.sdk.modules.familyFileExport

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.io.IOException

object DocumentCopy {
    fun isPrivateArchive(sourcePath: String, context: Context): Boolean {
        val source = File(sourcePath).canonicalFile
        if (!source.isFile || !source.canRead() || !source.name.matches(Regex("wardrobe-[0-9]+\\.zip"))) return false
        val roots = listOfNotNull(
            File(context.applicationInfo.dataDir),
            context.getExternalFilesDir(null)?.parentFile
        )
        return roots.any { source.path.startsWith(it.canonicalPath + File.separator) }
    }

    fun copyArchive(sourcePath: String, destination: Uri, context: Context) {
        if (!isPrivateArchive(sourcePath, context) || destination.scheme != "content") throw IOException("INVALID_EXPORT_SOURCE")
        FileInputStream(File(sourcePath).canonicalFile).use { input ->
            val destinationStream = context.contentResolver.openOutputStream(destination, "wt")
                ?: throw IOException("EXPORT_DESTINATION_UNAVAILABLE")
            destinationStream.use { output ->
                // Stream raw bytes; never encode ZIP data as a Java/Kotlin string.
                input.copyTo(output)
                output.flush()
            }
        }
    }
}
