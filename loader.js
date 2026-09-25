const load_jdy_print = () => {
    const script = document.createElement('script');
    // 可替换为自己的远程脚本地址
    script.src = 'https://v4m8.oss-cn-beijing.aliyuncs.com/jdy_print/v2/injected.js';
    script.onload = () => script.remove();
    document.head.appendChild(script);
}
load_jdy_print();