package uts.sdk.modules.familyAppUpdate

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

object ApkVerifier {
    private fun code(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> {
        val certificates = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return certificates?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    @Suppress("DEPRECATION")
    fun verify(context: Context, sourcePath: String, sha256: String, size: Number, versionCode: Number,
               success: () -> Unit, failure: (String) -> Unit) {
        val app = context.applicationContext
        Thread {
            try {
                val source = File(sourcePath.removePrefix("file://")).canonicalFile
                val roots = listOfNotNull(File(app.applicationInfo.dataDir), app.getExternalFilesDir(null)?.parentFile)
                check(roots.any { source.path.startsWith(it.canonicalPath + File.separator) })
                check(source.isFile && source.canRead() && source.length() == size.toLong())
                val digest = MessageDigest.getInstance("SHA-256")
                FileInputStream(source).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var count = input.read(buffer)
                    while (count >= 0) { if (count > 0) digest.update(buffer, 0, count); count = input.read(buffer) }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                check(actual == sha256)
                val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
                val candidate = app.packageManager.getPackageArchiveInfo(source.path, flags) ?: error("APK_INVALID")
                val installed = app.packageManager.getPackageInfo(app.packageName, flags)
                check(candidate.packageName == app.packageName && app.packageName == "com.applejq.familyhome")
                check(code(candidate) == versionCode.toLong() && code(candidate) > code(installed))
                val installedSignatures = signatures(installed)
                check(installedSignatures.isNotEmpty() && signatures(candidate) == installedSignatures)
                Handler(Looper.getMainLooper()).post { success() }
            } catch (_: Exception) {
                Handler(Looper.getMainLooper()).post { failure("安装包校验未通过，请重新下载；发布者需核对包名、版本和签名") }
            }
        }.start()
    }

    fun canInstallPackages(context: Context): Boolean =
        Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun openInstallSettings(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
