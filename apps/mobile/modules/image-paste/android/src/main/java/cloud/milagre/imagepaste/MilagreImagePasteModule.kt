package cloud.milagre.imagepaste

import android.graphics.BitmapFactory
import android.net.Uri
import android.view.View
import androidx.core.view.ViewCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.lang.ref.WeakReference

class MilagreImagePasteModule : Module() {
  private val inputs = mutableMapOf<Int, WeakReference<View>>()

  override fun definition() = ModuleDefinition {
    Name("MilagreImagePaste")
    Events("imagePaste")

    AsyncFunction("attachAsync") { tag: Int ->
      val view = appContext.findView<View>(tag) ?: return@AsyncFunction false
      ViewCompat.setOnReceiveContentListener(view, arrayOf("image/*")) { _, payload ->
        val split = payload.partition { item ->
          item.uri != null && view.context.contentResolver.getType(item.uri!!)?.startsWith("image/") == true
        }
        split.first?.let {
          for (index in 0 until it.clip.itemCount) paste(view, it.clip.getItemAt(index).uri, tag)
        }
        split.second
      }
      inputs[tag] = WeakReference(view)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("detachAsync") { tag: Int ->
      inputs.remove(tag)?.get()?.let { ViewCompat.setOnReceiveContentListener(it, null, null) }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      inputs.values.forEach { reference -> reference.get()?.let { view ->
        view.post { ViewCompat.setOnReceiveContentListener(view, null, null) }
      } }
      inputs.clear()
    }
  }

  private fun paste(view: View, uri: Uri, tag: Int) {
    var file: File? = null
    try {
      file = File.createTempFile("milagre-paste-", ".image", view.context.cacheDir)
      view.context.contentResolver.openInputStream(uri).use { input ->
        checkNotNull(input)
        file.outputStream().use { output ->
          val buffer = ByteArray(8192)
          var total = 0
          var count = input.read(buffer)
          while (count != -1) {
            total += count
            check(total <= 20 * 1024 * 1024) { "Image too large" }
            output.write(buffer, 0, count)
            count = input.read(buffer)
          }
        }
      }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.absolutePath, bounds)
      check(bounds.outWidth > 0 && bounds.outHeight > 0)
      sendEvent("imagePaste", mapOf("target" to tag, "uri" to Uri.fromFile(file).toString(), "width" to bounds.outWidth, "height" to bounds.outHeight))
    } catch (_: Exception) {
      file?.delete()
      sendEvent("imagePaste", mapOf("target" to tag, "uri" to "", "width" to 0, "height" to 0,
        "error" to "Could not prepare the pasted image. Try Photo Library instead."))
    }
  }
}
