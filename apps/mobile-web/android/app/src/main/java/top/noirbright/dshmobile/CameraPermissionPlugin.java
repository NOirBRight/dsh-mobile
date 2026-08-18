package top.noirbright.dshmobile;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Resolves the runtime camera permission before the third-party scanner Activity starts. */
@CapacitorPlugin(
    name = "DshCameraPermission",
    permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) }
)
public class CameraPermissionPlugin extends Plugin {
    @PluginMethod
    public void ensure(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            resolveGranted(call);
            return;
        }
        requestPermissionForAlias("camera", call, "cameraPermissionCallback");
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            resolveGranted(call);
        } else {
            call.reject("Camera permission is required to scan a DSH pairing QR code", "CAMERA_PERMISSION_DENIED");
        }
    }

    private void resolveGranted(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", true);
        call.resolve(result);
    }
}
