# 静默打印助手V2 — 适配简道云

在 [简道云](https://www.jiandaoyun.com/dashboard#/) 页面中绕过原生打印预览，直接通过 [ZeroPrint](https://webappprint.cn/) 服务发送打印任务，实现无预览、无人工干预的静默打印。[帮助文档](https://webappprint.cn/silent-print-assistant/)

## 远端注入脚本部署

为避免维护和升级导致用户重新安装扩展，业务逻辑放在远端脚本中，扩展本身只负责加载并触发它。

### 1. 压缩脚本

压缩脚本可减少体积和加载时间，输出到远端目录的 `dist` 子目录中。

```powershell
npx terser remote-static/injected.js -o remote-static/dist/injected.js -c passes=3,drop_console=true,drop_debugger=true,dead_code=true -m toplevel=true --comments "/Copyright|Project|Author|License|MIT/"
```

### 2. 上传到 OSS / CDN / 静态托管

将压缩产物上传到自己的对象存储或静态托管目录，并确保浏览器可以通过 HTTPS 访问。示例路径如下：

```text
https://v4m8.oss-cn-beijing.aliyuncs.com/jdy_print/v2/injected.js
```

如果你使用的是自己的域名或存储桶，路径可以改成类似：

```text
https://your-domain.com/injected.js
```

### 3. 发布前验证

你需要先直接访问最终部署的 URL，确认返回的是压缩后的 JavaScript 内容且状态码为 `200`。

### 4. 同步更新扩展中的远程地址

更新 [loader.js](loader.js) 中的 `script.src`。

## 许可证

本项目采用 [MIT License](LICENSE) 发布。你可以自由使用、复制、修改、发布和再许可本项目，但需要保留原版权声明和许可证文本。

## 免责声明

本项目仅包含项目作者拥有版权的源代码。简道云及其相关平台、商标、接口、页面资源和数据均归其各自权利人所有。本项目与简道云官方不存在隶属、授权或合作关系。

使用者应自行确认具体使用方式符合简道云及相关平台的服务条款、法律法规和其他权利人的要求。MIT License 不代表本项目获得了简道云或任何第三方的授权，也不授予使用其商标、平台资源、接口或数据的权利。
