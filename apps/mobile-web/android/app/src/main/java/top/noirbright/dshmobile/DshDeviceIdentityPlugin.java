package top.noirbright.dshmobile;

import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DshDeviceIdentity")
public class DshDeviceIdentityPlugin extends Plugin {
    @PluginMethod
    public void getName(PluginCall call) {
        String name = Settings.Global.getString(getContext().getContentResolver(), "device_name");
        if (name == null || name.trim().isEmpty()) {
            String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
            String model = Build.MODEL == null ? "" : Build.MODEL.trim();
            name = model.toLowerCase().startsWith(manufacturer.toLowerCase())
                ? model
                : (manufacturer + " " + model).trim();
        }
        if (name == null || name.trim().isEmpty()) name = "Android device";
        JSObject result = new JSObject();
        result.put("name", name);
        call.resolve(result);
    }
}
