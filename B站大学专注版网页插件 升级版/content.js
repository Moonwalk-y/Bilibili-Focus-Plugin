let password = '';
let reminders = ['请输入密码以退出全屏模式']; // 默认提示语
let passwordVerified = false;
let isManualFullscreen = false;
let isExiting = false;

// 在文件开头添加快捷键配置
const SHORTCUT_KEYS = {
    RESET_PASSWORD: 'r',  // Ctrl + Alt + R 重置密码和提醒语
};

// 添加状态管理对象
const state = {
    isFullscreen: false,
    isValidating: false,
    isProcessing: false,
    startTime: null,
    
    setFullscreen(value) {
        this.isFullscreen = value;
        if (value) {
            enterFullscreen();
        } else {
            cleanupFullscreen();
        }
    },

    // 添加其他状态管理方法
    setValidating(value) {
        this.isValidating = value;
    },

    setProcessing(value) {
        this.isProcessing = value;
    }
};

// 存储处理
const storage = {
    get: function(keys, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(keys, callback);
        } else {
            const result = {};
            keys.forEach(key => {
                result[key] = localStorage.getItem(key);
            });
            callback(result);
        }
    },
    set: function(items, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set(items, callback);
        } else {
            Object.keys(items).forEach(key => {
                localStorage.setItem(key, items[key]);
            });
            if (callback) callback();
        }
    }
};

// 添加配置管理
const config = {
    defaultVolume: 0.5,
    // B站首页URL匹配
    homePageUrls: [
        'https://www.bilibili.com/',
        'https://bilibili.com/',
        'https://www.bilibili.com/index.html'
    ]
};

// 等待元素加载完成的函数
function waitForElement(selector, callback, maxTries = 20) {
    let tries = 0;
    
    function check() {
        const element = document.querySelector(selector);
        if (element) {
            callback(element);
            return;
        }
        
        tries++;
        if (tries < maxTries) {
            setTimeout(check, 500);
        }
    }
    
    check();
}

// 修改页面类型判断函数，增加搜索页面判断
function isSearchPage() {
    const url = window.location.href.toLowerCase();
    return url.includes('search.bilibili.com');
}

// 修改页面类型判断函数，更精确地识别页面类型
function isVideoPage() {
    const url = window.location.href.toLowerCase();
    // 更精确地匹配视频页面URL
    return (
        url.includes('bilibili.com/video/') ||
        url.includes('bilibili.com/bangumi/play/') ||
        url.includes('bilibili.com/cheese/play/')
    );
}

function isHomePage(url = window.location.href) {
    const urlToCheck = url.split('?')[0].toLowerCase();
    // 严格匹配首页URL
    return (
        urlToCheck === 'https://www.bilibili.com' ||
        urlToCheck === 'https://www.bilibili.com/' ||
        urlToCheck === 'https://bilibili.com' ||
        urlToCheck === 'https://bilibili.com/'
    );
}

// 修改 initPlugin 函数，确保更早地拦截首页加载
function initPlugin() {
    // 防止重复初始化
    if (window._pluginInitialized) return;
    window._pluginInitialized = true;

    // 如果是首页，立即停止加载并设置搜索界面
    if (isHomePage()) {
        // 立即停止页面加载
        window.stop();
        setupHomePage();
        return;
    }

    // 其他页面等待DOM加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeFeatures);
    } else {
        initializeFeatures();
    }
}

// 修改初始化顺序，确保更可靠的执行
// 在文件开头添加
const initializeHome = () => {
    if (isHomePage() && !window._pluginInitialized) {
        window.stop();
        initPlugin();
    }
};

// 使用多重保护确保初始化
document.addEventListener('readystatechange', initializeHome, { once: true });
document.addEventListener('DOMContentLoaded', initializeHome, { once: true });
window.addEventListener('load', initializeHome, { once: true });

function initializeFeatures() {
    // 清理可能的残留状态
    setupPageBehavior();
    
    // 检查页面类型并应用相应功能
    if (isVideoPage()) {
        console.log('检测到视频页面，应用专注模式');
        storage.get(['password'], function(result) {
            try {
                if (result.password) {
                    // 已有密码设置，直接使用
                    password = result.password;
                    enterFullscreen();
                    setupLinkInterception();
                    setupExitListeners();
                    setTimeout(restoreVideoVolume, 1000);
                } else {
                    // 只在首次使用时设置密码
                    setupInitialPassword();
                }
                setupShortcuts();
            } catch (error) {
                console.error('初始化失败:', error);
            }
        });
    } else if (isHomePage()) {
        console.log('检测到首页，应用简洁搜索界面');
        setupHomePage();
    } else if (isSearchPage()) {
        console.log('检测到搜索页面，保持原有界面');
        // 完全恢复原始状态
        restoreOriginalState();
    } else {
        console.log('其他页面，保持原有界面');
        document.body.classList.remove('video-page');
        const existingStyles = document.querySelectorAll('style[data-plugin-style]');
        existingStyles.forEach(style => style.remove());
    }
}

// 设置初始密码 - 修改为只设置密码
function setupInitialPassword() {
    // 检查是否已经有配置进行中，防止重复调用
    if (window._configSetupInProgress) {
        return;
    }
    window._configSetupInProgress = true;
    
    const newPassword = prompt('请设置退出全屏的密码：');
    if (!newPassword) {
        window._configSetupInProgress = false;
        return;
    }

    // 设置密码
    password = newPassword;
    storage.set({
        password: newPassword
    }, function() {
        window._configSetupInProgress = false;
        enterFullscreen();
        setupLinkInterception();
        setupExitListeners();
    });
}

// 修改链接拦截设置，允许搜索页面正常工作
function setupLinkInterception() {
    // 在搜索页面不添加任何拦截
    if (isSearchPage()) {
        return;
    }

    document.addEventListener('click', function(e) {
        let target = e.target;
        
        while (target && target !== document.body) {
            if (target.tagName === 'A' || target.hasAttribute('href') || 
                target.classList.contains('nav-link') || 
                target.classList.contains('v-popover-wrap') || 
                target.hasAttribute('data-v-navbar')) {
                
                handleLinkClick(e, target);
                return;
            }
            target = target.parentElement;
        }
    }, true);
}

// 修改链接点击处理函数
function handleLinkClick(e, target) {
    // 获取实际链接
    let href = target.href || target.getAttribute('href');
    if (!href) return true;

    // 如果是搜索页面，完全不拦截任何链接
    if (isSearchPage()) {
        return true;
    }

    // 如果不是在视频页面，只处理首页跳转
    if (!isVideoPage()) {
        if (isHomePage(href)) {
        e.preventDefault();
            setupHomePage();
        return false;
    }
        return true;  // 允许其他所有跳转
    }

    // 检查链接类型
    const isBilibiliLink = href.includes('bilibili.com') || 
                          href.startsWith('/') || 
                          href.startsWith('#');

    // 在视频页面中的处理
    if (isBilibiliLink) {
        // 检查是否是视频链接
        const isVideoLink = href.includes('/video/') || 
                          href.includes('/bangumi/play/') ||
                          href.includes('/cheese/play/');

        if (isVideoLink) {
            // 视频间切换只需简单确认
            e.preventDefault();
            if (confirm('确定要跳转到其他视频吗？')) {
                window.location.href = href;
            }
            return false;
        }

        // 首页跳转
        if (isHomePage(href)) {
            e.preventDefault();
            setupHomePage();
            return false;
        }
        
        // 其他B站内部页面需要验证
        e.preventDefault();
        e.stopPropagation();
        if (!state.isProcessing) {
            startExitCheck();
        }
        return false;
    }

    // 外部链接需要完整验证
    e.preventDefault();
    e.stopPropagation();
    if (!state.isProcessing) {
        startExitCheck();
    }
    return false;
}

// 修改事件监听器设置
function setupFullscreenProtection() {
    // 只在视频页面添加保护
    if (!isVideoPage()) {
        return;
    }

    document.addEventListener('keydown', handleKeyPress, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    
    // 监听全屏按钮点击
    const fullscreenButtons = document.querySelectorAll('.bpx-player-ctrl-btn-fullscreen, .bilibili-player-video-btn-fullscreen');
    fullscreenButtons.forEach(button => {
        button.addEventListener('click', handleFullscreenButtonClick, true);
    });
    
    // 修改全屏变化监听器
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            // 如果是正常退出流程，不做处理
            if (passwordVerified || isExiting) {
                return;
            }
            
            // 如果已经在验证中，不要重复触发
            if (state.isValidating) {
                return;
            }
            
            // 开始验证流程
            state.setValidating(true);
            startExitCheck();
        }
    });
    
    // 现有的监听器
    window.addEventListener('keydown', handleBrowserShortcuts, true);
    
    // 禁用所有导航相关元素
    disableNavigation();

    // 添加额外的事件拦截
    document.addEventListener('mousedown', preventEvent, true);
    document.addEventListener('click', preventEvent, true);
    document.addEventListener('contextmenu', preventEvent, true);
    
    // 禁用所有表单元素
    document.querySelectorAll('input, button, select, textarea, a').forEach(element => {
        element.disabled = true;
        element.style.pointerEvents = 'none';
    });

    // 修改页面可见性变化监听器
    document.addEventListener('visibilitychange', () => {
        // 无论是隐藏还是显示，都立即恢复焦点和全屏
        if (!isExiting && !passwordVerified) {
            window.focus();
            setTimeout(() => {
                enterFullscreen();
            }, 100);
        }
    }, true);

    // 添加更强的标签页切换控制
    window.addEventListener('blur', (e) => {
        if (!isExiting && !passwordVerified) {
            e.preventDefault();
            e.stopPropagation();
            window.focus();
            setTimeout(() => {
                enterFullscreen();
            }, 100);
        }
    }, true);

    // 阻止所有可能导致切换标签页的快捷键
    window.addEventListener('keydown', (e) => {
        const forbiddenKeys = [
            'Tab',          // Tab 键
            't', 'w',       // Ctrl+T, Ctrl+W
            'r', 'l',       // Ctrl+R, Ctrl+L
            'PageUp',       // PageUp
            'PageDown',     // PageDown
            'F5'            // F5
        ];
        
        if (
            (e.ctrlKey && forbiddenKeys.includes(e.key)) ||
            (e.altKey && e.key === 'Tab') ||
            (e.key === 'F5') ||
            (e.metaKey && forbiddenKeys.includes(e.key))  // Meta键(Windows/Command)
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    // 禁用浏览器默认的标签页切换行为
    document.addEventListener('visibilitychange', (e) => {
        if (!isExiting && !passwordVerified) {
            e.preventDefault();
            e.stopPropagation();
            if (document.hidden) {
                window.focus();
                setTimeout(() => {
                    enterFullscreen();
                }, 100);
            }
        }
    }, true);

    // 阻止鼠标事件可能触发的标签页切换
    document.addEventListener('mousedown', (e) => {
        if (e.button === 1) {  // 中键点击
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    // 阻止拖拽标签页
    document.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }, true);
}

// 修改导航禁用函数
function disableNavigation() {
    // 禁用所有链接
    document.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', function(e) {
            // 检查是否是B站内部链接
            const isBilibiliLink = link.href && (
                link.href.includes('bilibili.com') || 
                link.href.startsWith('/') || 
                link.href.startsWith('#')
            );
            
            if (isBilibiliLink) {
                // 如果是视频页面，允许直接跳转
                if (link.href.includes('/video/') || 
                    link.href.includes('/bangumi/') ||
                    link.href.includes('/cheese/')) {
                    return true;
                }
                
                // 如果是首页，应用首页处理
                if (isHomePage(link.href)) {
                    e.preventDefault();
                    window.stop();
                    setupHomePage();
                    return false;
                }
                
                // 其他B站页面允许直接跳转
                return true;
            }
            
            e.preventDefault();
            e.stopPropagation();
            checkPasswordBeforeAction("要跳转到其他页面吗？");
            return false;
        }, true);
    });

    // 禁用浏览器导航栏
    history.pushState(null, null, document.URL);
    window.addEventListener('popstate', function() {
        history.pushState(null, null, document.URL);
        // 检查是否是浏览器后退到B站内部页面
        const previousUrl = document.referrer;
        if (previousUrl && previousUrl.includes('bilibili.com')) {
            return true;
        }
        checkPasswordBeforeAction("要离开B站吗？");
    });
}

// 创建全局遮罩层
function createGlobalOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'global-overlay';
    
    // 阻止所有可能的事件
    overlay.addEventListener('click', preventEvent, true);
    overlay.addEventListener('mousedown', preventEvent, true);
    overlay.addEventListener('mouseup', preventEvent, true);
    overlay.addEventListener('keydown', preventEvent, true);
    overlay.addEventListener('keyup', preventEvent, true);
    overlay.addEventListener('keypress', preventEvent, true);
    
    document.body.appendChild(overlay);
    return overlay;
}

// 阻止事件传播
function preventEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
}

// 修改退出监听器设置，添加更严格的状态控制
function setupExitListeners() {
    let isHandlingExit = false; // 添加处理中标记
    
    // 创建统一的退出检查处理函数
    const handleExitAttempt = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // 严格检查状态，确保不会重复触发
        if (isHandlingExit || state.isProcessing || !document.body.classList.contains('video-page')) {
            return;
        }

        // 标记正在处理退出
        isHandlingExit = true;
        
        // 使用 requestAnimationFrame 确保状态更新
        requestAnimationFrame(() => {
            startExitCheck();
            // 短暂延迟后重置状态
            setTimeout(() => {
                isHandlingExit = false;
            }, 500);
        });
    };

    // 监听所有可能的退出行为
    const exitEvents = [
        { type: 'keydown', condition: e => e.key === 'Escape' || e.key === 'Esc' },
        { type: 'keydown', condition: e => e.key === 'F11' },
        { type: 'fullscreenchange', condition: () => !document.fullscreenElement && !isExiting },
        { type: 'mousedown', condition: e => e.button === 1 }, // 中键点击
        { type: 'keydown', condition: e => e.altKey && e.key === 'Enter' } // Alt+Enter
    ];

    // 使用事件委托来减少事件监听器数量
    const handleEvent = (e) => {
        const eventType = e.type;
        const matchingEvent = exitEvents.find(event => 
            event.type === eventType && event.condition(e)
        );
        
        if (matchingEvent) {
            handleExitAttempt(e);
        }
    };

    // 只添加必要的事件监听器
    document.addEventListener('keydown', handleEvent, true);
    document.addEventListener('mousedown', handleEvent, true);
    document.addEventListener('fullscreenchange', handleEvent, true);

    // 监听播放器双击事件
    waitForElement('#bilibili-player', (player) => {
        // 监听播放器内的退出全屏按钮
        const fullscreenBtns = [
            '.bpx-player-ctrl-btn-fullscreen',
            '.bilibili-player-video-btn-fullscreen',
            '.squirtle-video-fullscreen'
        ];

        // 使用事件委托处理按钮点击
        player.addEventListener('click', (e) => {
            const isFullscreenBtn = fullscreenBtns.some(selector => 
                e.target.matches(selector) || e.target.closest(selector)
            );
            
            if (isFullscreenBtn) {
                handleExitAttempt(e);
            }
        }, true);

        // 优化双击事件处理
        let lastClickTime = 0;
        player.addEventListener('click', (e) => {
            const currentTime = new Date().getTime();
            if (currentTime - lastClickTime < 300) {  // 双击判定
                const isInBrowserFullscreen = document.fullscreenElement !== null;
                
                if (isInBrowserFullscreen) {
                    handleExitAttempt(e);
                } else {
                    // 进入全屏后自动恢复专注模式
                        useBackupFullscreen(player);
                    // 添加延时，等待全屏动画完成后恢复专注模式
                    setTimeout(() => {
                        if (isVideoPage()) {
                            passwordVerified = false;
                            isExiting = false;
                            state.setValidating(false);
                            state.setProcessing(false);
                            enterFullscreen();
                        }
                    }, 300);
                }
            }
            lastClickTime = currentTime;
        }, true);
    });

    // 禁用右键菜单
    document.addEventListener('contextmenu', (e) => {
        if (document.body.classList.contains('video-page')) {
            e.preventDefault();
        }
    }, true);
}

// 修改退出验证流程，移除提示语
function startExitCheck() {
    // 防止重复触发
    if (state.isProcessing || state.isValidating) {
        return;
    }
    
    // 立即设置状态标记
    state.setProcessing(true);
    state.setValidating(true);
    let isDialogActive = false;  // 新增弹窗状态标记
    let overlayRemoved = false;  // 新增遮罩层状态标记

    // 保存当前视频播放状态
    const videoPlayer = getVideoPlayer();
    const wasPlaying = videoPlayer && !videoPlayer.paused;
    if (videoPlayer) {
        videoPlayer.pause();
    }

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.7);
        z-index: 2147483647;
        display: flex;
        justify-content: center;
        align-items: center;
    `;
    document.body.appendChild(overlay);

    // 统一的取消处理函数 - 确保只执行一次
    const handleCancel = () => {
        if (overlayRemoved) return;  // 防止重复执行
        overlayRemoved = true;

        // 立即移除遮罩层
        if (document.body.contains(overlay)) {
            overlay.remove();
        }
        
        // 立即重置所有状态
        state.setProcessing(false);
        state.setValidating(false);
        isExiting = false;
        isDialogActive = false;
        
        // 恢复视频播放
        if (videoPlayer && wasPlaying) {
            const playPromise = videoPlayer.play().catch(() => {
                // 如果自动播放失败，添加一次性点击事件
                    const playHandler = () => {
                        videoPlayer.play().catch(() => {});
                    document.removeEventListener('click', playHandler);
                    };
                document.addEventListener('click', playHandler);
                });
        }
        
        // 使用 requestAnimationFrame 确保平滑过渡
        requestAnimationFrame(() => {
            if (!state.isValidating && !isExiting && !passwordVerified) {
                enterFullscreen();
            }
        });
    };

    // 点击遮罩层空白处取消
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && !isDialogActive) {
            handleCancel();
        }
    });

    // 显示密码验证
    function showPasswordDialog() {
        // 如果已经取消或移除遮罩层，不再继续
        if (overlayRemoved || !document.body.contains(overlay)) {
            return;
        }

        // 防止重复显示弹窗
        if (isDialogActive) {
            return;
        }
        isDialogActive = true;

        // 使用 setTimeout 确保异步执行
        setTimeout(() => {
            // 再次检查状态
            if (overlayRemoved) {
                isDialogActive = false;
                return;
            }

            // 显示密码输入框
            const userInput = window.prompt('请输入密码：');
            isDialogActive = false;
            
            if (!userInput) {
                handleCancel();
                return;
            }

            if (userInput !== password) {
                alert('密码错误！');
                handleCancel();
                return;
            }

            // 最终确认
            isDialogActive = true;
            const finalConfirm = window.confirm('确认要退出全屏模式吗？\n\n点击"确定"退出\n点击"取消"继续学习');
            isDialogActive = false;
            
            if (!finalConfirm) {
                handleCancel();
                return;
            }

            // 验证通过，正常退出
            overlayRemoved = true;
            if (document.body.contains(overlay)) {
                overlay.remove();
            }
            passwordVerified = true;
            state.setValidating(false);
            isExiting = true;
            state.setProcessing(false);
            cleanupFullscreen();
        }, 0);
    }

    // 直接显示密码验证对话框
    showPasswordDialog();
}

// 修改密码检查函数
async function checkPasswordBeforeAction(message) {
    // 保存当前视频播放状态
    const videoPlayer = getVideoPlayer();
    const wasPlaying = videoPlayer && !videoPlayer.paused;
    
    // 暂停视频
    if (videoPlayer && wasPlaying) {
        videoPlayer.pause();
    }

    // 使用 prompt 进行密码验证
    const userInput = prompt(`请输入密码：`);
    
    if (userInput === password) {
        passwordVerified = true;
        return true;
    }
    
    // 如果取消或密码错误，强制恢复播放并保持全屏
    if (videoPlayer) {
        // 确保视频继续播放
        if (wasPlaying) {
            const playPromise = videoPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    document.addEventListener('click', () => {
                        videoPlayer.play();
                    }, { once: true });
                });
            }
        }
        // 强制进入全屏
        enterFullscreen();
    }
    
    if (userInput !== null && userInput !== password) {
        alert('密码错误，请重试！');
    }
    return false;
}

// 修改键盘事件处理
function handleKeyPress(e) {
    // 处理 F11 键
    if (e.key === 'F11') {
        e.preventDefault();
        if (!isVideoPage()) return;
        
        if (document.fullscreenElement || isExiting) {
            startExitCheck();
        } else {
            // 如果不在全屏模式，直接恢复
            passwordVerified = false;
            isExiting = false;
            state.setValidating(false);
            state.setProcessing(false);
            enterFullscreen();
        }
        return;
    }

    // 拦截 ESC 键
    if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        startExitCheck();
        return false;
    }
    
    // 拦截其他快捷键
    if (
        (e.altKey && e.key === 'Tab') ||
        (e.ctrlKey && e.key === 'Tab') ||
        (e.altKey && e.key === 'F4') ||
        (e.ctrlKey && e.key === 'w') ||
        (e.ctrlKey && e.key === 't') ||
        (e.ctrlKey && e.key === 'n') ||
        (e.winKey || e.key === 'Meta')
    ) {
        e.preventDefault();
        e.stopPropagation();
        checkPasswordBeforeAction("要切换窗口吗？");
        return false;
    }
}

// 处理全屏按钮点击
function handleFullscreenButtonClick(e) {
    if (document.fullscreenElement) {
        e.preventDefault();
        e.stopPropagation();
        startExitCheck();
        return false;
    }
}

// 处理右键菜单
function handleContextMenu(e) {
    if (document.fullscreenElement) {
        e.preventDefault();
        return false;
    }
}

// 处理浏览器快捷键
function handleBrowserShortcuts(e) {
    // 拦截可能导致退出全屏的组合键
    if ((e.ctrlKey && e.key === 'w') || // Ctrl+W
        (e.altKey && e.key === 'F4') || // Alt+F4
        (e.key === 'F11')) {            // F11
        e.preventDefault();
        e.stopPropagation();
        startExitCheck();
        return false;
    }
}

// 退出全屏
function exitFullscreen() {
    try {
        // 使用B站原生的退出全屏按钮
        const exitFullscreenButton = document.querySelector('.bpx-player-ctrl-btn-fullscreen, .bilibili-player-video-btn-fullscreen');
        if (exitFullscreenButton) {
            exitFullscreenButton.click();
        } else {
            // 如果找不到按钮，手动清理全屏样式
            cleanupFullscreen();
        }
    } catch (error) {
        console.log('使用备用退出全屏模式');
        cleanupFullscreen();
    }
}

// 修改隐藏元素函数，确保完全隐藏所有干扰元素
function hideElements() {
    if (!isVideoPage()) return;

    // 关闭弹幕
    function disableDanmaku() {
        const danmakuSwitches = [
            '.bpx-player-dm-switch input[type="checkbox"]',
            '.bilibili-player-video-danmaku-switch input[type="checkbox"]',
            '.bilibili-player-video-danmaku-switch .bui-switch-input'
        ];

        for (const selector of danmakuSwitches) {
            const switchElement = document.querySelector(selector);
            if (switchElement && switchElement.checked) {
                switchElement.click();
                break;
            }
        }
    }

    disableDanmaku();
    
    // 添加选集按钮
    addPlaylistButton();

    const style = document.createElement('style');
    style.setAttribute('data-plugin-style', 'true');
    style.textContent = `
        /* 隐藏所有干扰元素，但保留选集区域 */
        body.video-page .bili-header__bar,
        body.video-page .nav-tools,
        body.video-page .mini-header,
        body.video-page .v-wrap .v-content,
        body.video-page .right-container,
        body.video-page .comment-container,
        body.video-page .video-toolbar,
        body.video-page .video-desc,
        body.video-page .up-info,
        body.video-page .recommend-list,
        body.video-page .fixed-nav,
        body.video-page .float-nav,
        body.video-page .danmukuBox,
        body.video-page .bpx-player-top-wrap,
        body.video-page .bpx-player-sending-bar,
        body.video-page .bpx-player-video-info,
        body.video-page .bpx-player-dm-wrap,
        body.video-page .bpx-player-dm-btn-wrap,
        body.video-page .recommend-container,
        body.video-page .footer {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            height: 0 !important;
            width: 0 !important;
            position: absolute !important;
            z-index: -9999 !important;
        }
        
        /* 默认隐藏选集区域，但保留其存在 */
        body.video-page .video-section-list,
        body.video-page .multi-page,
        body.video-page .video-episode-card__info,
        body.video-page .video-episodes-list,
        body.video-page .player-auxiliary-playlist-list,
        body.video-page .bpx-player-auxiliary-playlist-list,
        body.video-page .list-box,
        body.video-page .ep-list,
        body.video-page .player-auxiliary-playlist,
        body.video-page .bpx-player-auxiliary-playlist,
        body.video-page .video-section,
        body.video-page .video-episodes,
        body.video-page .video-episode-card,
        body.video-page .bpx-player-auxiliary-area,
        body.video-page .bpx-player-auxiliary,
        body.video-page .player-auxiliary,
        body.video-page .bpx-player-sending-area {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
        
        /* 视频播放器全屏显示 */
        body.video-page #bilibili-player {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 999999 !important;
            background: black !important;
        }

        /* 禁止页面滚动 */
        body.video-page {
            overflow: hidden !important;
            height: 100vh !important;
            width: 100vw !important;
            position: fixed !important;
        }

        /* 控制栏默认隐藏 */
        body.video-page .bpx-player-control-wrap {
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        /* 鼠标移动时显示控制栏 */
        body.video-page #bilibili-player:hover .bpx-player-control-wrap {
            opacity: 1;
        }
    `;
    
    document.head.appendChild(style);
    document.body.classList.add('video-page');
}

// 修改按钮样式
function addPlaylistButton() {
    // 检查是否已经添加过按钮
    if (document.querySelector('.playlist-button')) {
        return;
    }
    
    // 创建按钮
    const button = document.createElement('button');
    button.className = 'playlist-button';
    button.id = 'custom-playlist-button';
    button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="8" y1="12" x2="16" y2="12"></line>
            <line x1="8" y1="7" x2="16" y2="7"></line>
            <line x1="8" y1="17" x2="16" y2="17"></line>
        </svg>
    `;
    
    // 设置按钮样式
    button.style.position = 'fixed';
    button.style.right = '20px';
    button.style.top = '50%';
    button.style.transform = 'translateY(-50%)';
    button.style.background = 'rgba(0, 161, 214, 0.8)';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '50%';
    button.style.width = '48px';
    button.style.height = '48px';
    button.style.display = 'flex';
    button.style.justifyContent = 'center';
    button.style.alignItems = 'center';
    button.style.cursor = 'pointer';
    button.style.zIndex = '2147483646';
    button.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
    button.style.transition = 'all 0.3s ease';
    button.style.opacity = '0.7';
    
    // 添加悬停效果
    button.onmouseover = function() {
        this.style.opacity = '1';
        this.style.transform = 'translateY(-50%) scale(1.1)';
        this.style.background = 'rgba(0, 161, 214, 1)';
        this.style.boxShadow = '0 4px 15px rgba(0, 161, 214, 0.4)';
    };
    
    button.onmouseout = function() {
        this.style.opacity = '0.7';
        this.style.transform = 'translateY(-50%)';
        this.style.background = 'rgba(0, 161, 214, 0.8)';
        this.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
    };
    
    // 添加到页面
    document.body.appendChild(button);
    
    // 添加点击事件
    button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('选集按钮被点击');
        
        // 直接显示原生选集区域
        showNativePlaylist();
    });
    
    // 设置SVG样式
    const svg = button.querySelector('svg');
    if (svg) {
        svg.style.width = '24px';
        svg.style.height = '24px';
    }
}

// 显示原生选集区域
function showNativePlaylist() {
    console.log('尝试显示原生选集区域');
    
    // 移除可能已存在的容器
    const existingContainer = document.querySelector('.native-playlist-container');
    if (existingContainer) {
        existingContainer.remove();
    }

    // 创建一个容器来存放选集区域
    const container = document.createElement('div');
    container.className = 'native-playlist-container';
    container.style.cssText = `
        position: fixed;
        right: 80px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2147483646;
        max-height: 80vh;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 8px;
        padding: 16px;
        color: white;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        min-width: 300px;
        max-width: 400px;
    `;

    // 添加标题
    const title = document.createElement('div');
    title.textContent = '视频选集';
    title.style.cssText = `
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    `;
    container.appendChild(title);

    // 尝试直接获取视频信息
    let videoInfo = '';
    try {
        // 尝试从页面中获取视频标题
        const videoTitle = document.querySelector('.video-title, .media-title, h1');
        if (videoTitle) {
            videoInfo = `<div style="margin-bottom: 15px; font-size: 14px; color: #ccc;">${videoTitle.textContent.trim()}</div>`;
            container.innerHTML += videoInfo;
        }
    } catch (e) {
        console.error('获取视频信息失败:', e);
    }

    // 尝试直接从页面获取分P信息
    let contentAdded = false;
    
    // 方法1: 尝试从window.__INITIAL_STATE__获取分P信息
    try {
        if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData && window.__INITIAL_STATE__.videoData.pages) {
            const pages = window.__INITIAL_STATE__.videoData.pages;
            if (pages && pages.length > 0) {
                console.log('从__INITIAL_STATE__找到分P信息:', pages.length);
                contentAdded = createPaginationFromData(container, pages);
            }
        }
    } catch (e) {
        console.error('从__INITIAL_STATE__获取分P信息失败:', e);
    }

    // 方法2: 尝试从window.__playinfo__获取分P信息
    if (!contentAdded) {
        try {
            if (window.__playinfo__ && window.__playinfo__.videoData && window.__playinfo__.videoData.pages) {
                const pages = window.__playinfo__.videoData.pages;
                if (pages && pages.length > 0) {
                    console.log('从__playinfo__找到分P信息:', pages.length);
                    contentAdded = createPaginationFromData(container, pages);
                }
            }
        } catch (e) {
            console.error('从__playinfo__获取分P信息失败:', e);
        }
    }

    // 方法3: 尝试从DOM元素获取分P信息
    if (!contentAdded) {
        // 尝试从页面元素获取分P信息
        const paginationElements = document.querySelectorAll('.list-box li, .multi-page .item, .video-episode-card, .ep-item');
        if (paginationElements && paginationElements.length > 0) {
            console.log('从DOM元素找到分P信息:', paginationElements.length);
            
            const paginationContainer = document.createElement('div');
            paginationContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-top: 15px;
            `;
            
            paginationElements.forEach((element, index) => {
                const clone = element.cloneNode(true);
                
                // 确保克隆的元素可见
                clone.style.display = 'block';
                clone.style.visibility = 'visible';
                clone.style.opacity = '1';
                clone.style.padding = '8px 12px';
                clone.style.borderRadius = '4px';
                clone.style.background = 'rgba(255, 255, 255, 0.1)';
                clone.style.transition = 'all 0.2s';
                
                // 添加悬停效果
                clone.onmouseover = function() {
                    this.style.background = 'rgba(255, 255, 255, 0.2)';
                    this.style.transform = 'translateX(3px)';
                };
                
                clone.onmouseout = function() {
                    this.style.background = 'rgba(255, 255, 255, 0.1)';
                    this.style.transform = 'translateX(0)';
                };
                
                paginationContainer.appendChild(clone);
            });
            
            container.appendChild(paginationContainer);
            contentAdded = true;
        }
    }

    // 方法4: 尝试从URL和页面元素获取分P信息
    if (!contentAdded) {
        contentAdded = tryGetPaginationInfo(container);
    }

    // 方法5: 如果以上方法都失败，尝试直接创建一个简单的分P列表
    if (!contentAdded) {
        // 尝试直接从URL获取当前分P
        const url = window.location.href;
        const bvMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
        
        if (bvMatch) {
            const bvid = bvMatch[1];
            console.log('尝试通过API获取分P信息:', bvid);
            
            // 创建一个临时的加载提示
            const loadingText = document.createElement('div');
            loadingText.textContent = '正在加载选集信息...';
            loadingText.style.textAlign = 'center';
            loadingText.style.padding = '20px 0';
            loadingText.style.color = '#ccc';
            container.appendChild(loadingText);
            
            // 先添加容器到页面，显示加载中
            document.body.appendChild(container);
            
            // 尝试通过API获取分P信息
            fetch(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`)
                .then(response => response.json())
                .then(data => {
                    if (data && data.data && data.data.length > 0) {
                        console.log('通过API获取到分P信息:', data.data.length);
                        
                        // 移除加载提示
                        loadingText.remove();
                        
                        // 创建分P列表
                        createPaginationFromApiData(container, data.data, bvid);
                    } else {
                        loadingText.textContent = '未找到选集信息';
                    }
                })
                .catch(error => {
                    console.error('API获取分P信息失败:', error);
                    loadingText.textContent = '获取选集信息失败';
                });
                
            contentAdded = true;
        }
    }

    // 如果没有添加任何内容，显示一个提示
    if (!contentAdded) {
        const noContentText = document.createElement('div');
        noContentText.textContent = '未找到选集信息';
        noContentText.style.textAlign = 'center';
        noContentText.style.padding = '20px 0';
        noContentText.style.color = '#ccc';
        container.appendChild(noContentText);
        document.body.appendChild(container);
    }

    // 添加关闭按钮
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.5);
        border: none;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        font-size: 16px;
    `;
    closeButton.onclick = () => container.remove();
    container.appendChild(closeButton);

    // 添加点击外部关闭
    document.addEventListener('click', function closePlaylist(e) {
        if (container && !container.contains(e.target) && 
            document.querySelector('.playlist-button') && 
            !document.querySelector('.playlist-button').contains(e.target)) {
            container.remove();
            document.removeEventListener('click', closePlaylist);
        }
    });

    // 确保选集可以点击
    container.addEventListener('click', function(e) {
        const target = e.target.closest('a, [href], [data-href]');
        if (target) {
            const href = target.href || target.getAttribute('data-href');
            if (href) {
                window.location.href = href;
            }
        }
    });
}

// 从API数据创建分P列表
function createPaginationFromApiData(container, pages, bvid) {
    const paginationContainer = document.createElement('div');
    paginationContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 15px;
    `;
    
    // 获取当前分P
    const url = window.location.href;
    const currentP = url.match(/[?&]p=(\d+)/);
    const currentPage = currentP ? parseInt(currentP[1]) : 1;
    
    pages.forEach((page, index) => {
        const pageNumber = index + 1;
        const isCurrentPage = pageNumber === currentPage;
        
        const pageItem = document.createElement('a');
        pageItem.href = `/video/${bvid}?p=${pageNumber}`;
        pageItem.style.cssText = `
            display: flex;
            align-items: center;
            padding: 10px 12px;
            border-radius: 4px;
            background: ${isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
            color: white;
            text-decoration: none;
            transition: all 0.2s;
            ${isCurrentPage ? 'border-left: 3px solid #00a1d6;' : ''}
        `;
        
        // 添加悬停效果
        pageItem.onmouseover = function() {
            this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.5)' : 'rgba(255, 255, 255, 0.2)';
            this.style.transform = 'translateX(3px)';
        };
        
        pageItem.onmouseout = function() {
            this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)';
            this.style.transform = 'translateX(0)';
        };
        
        // 创建页码
        const pageNumberSpan = document.createElement('span');
        pageNumberSpan.textContent = `P${pageNumber}`;
        pageNumberSpan.style.cssText = `
            display: inline-block;
            min-width: 30px;
            text-align: center;
            margin-right: 10px;
            font-weight: bold;
            color: ${isCurrentPage ? '#00a1d6' : '#ccc'};
        `;
        
        // 创建标题
        const pageTitleSpan = document.createElement('span');
        pageTitleSpan.textContent = page.part || `第${pageNumber}集`;
        pageTitleSpan.style.cssText = `
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        
        // 创建时长
        if (page.duration) {
            const durationSpan = document.createElement('span');
            durationSpan.textContent = formatDuration(page.duration);
            durationSpan.style.cssText = `
                color: #aaa;
                font-size: 12px;
                margin-left: 8px;
            `;
            pageItem.appendChild(durationSpan);
        }
        
        pageItem.appendChild(pageNumberSpan);
        pageItem.appendChild(pageTitleSpan);
        
        paginationContainer.appendChild(pageItem);
    });
    
    container.appendChild(paginationContainer);
    return true;
}

// 从页面数据创建分P列表
function createPaginationFromData(container, pages) {
    const paginationContainer = document.createElement('div');
    paginationContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 15px;
    `;
    
    // 获取当前分P
    const url = window.location.href;
    const currentP = url.match(/[?&]p=(\d+)/);
    const currentPage = currentP ? parseInt(currentP[1]) : 1;
    
    // 获取视频ID
    const bvMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    const bvid = bvMatch ? bvMatch[1] : '';
    
    pages.forEach((page, index) => {
        const pageNumber = page.page || (index + 1);
        const isCurrentPage = pageNumber === currentPage;
        
        const pageItem = document.createElement('a');
        pageItem.href = `/video/${bvid}?p=${pageNumber}`;
        pageItem.style.cssText = `
            display: flex;
            align-items: center;
            padding: 10px 12px;
            border-radius: 4px;
            background: ${isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
            color: white;
            text-decoration: none;
            transition: all 0.2s;
            ${isCurrentPage ? 'border-left: 3px solid #00a1d6;' : ''}
        `;
        
        // 添加悬停效果
        pageItem.onmouseover = function() {
            this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.5)' : 'rgba(255, 255, 255, 0.2)';
            this.style.transform = 'translateX(3px)';
        };
        
        pageItem.onmouseout = function() {
            this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)';
            this.style.transform = 'translateX(0)';
        };
        
        // 创建页码
        const pageNumberSpan = document.createElement('span');
        pageNumberSpan.textContent = `P${pageNumber}`;
        pageNumberSpan.style.cssText = `
            display: inline-block;
            min-width: 30px;
            text-align: center;
            margin-right: 10px;
            font-weight: bold;
            color: ${isCurrentPage ? '#00a1d6' : '#ccc'};
        `;
        
        // 创建标题
        const pageTitleSpan = document.createElement('span');
        pageTitleSpan.textContent = page.part || page.title || `第${pageNumber}集`;
        pageTitleSpan.style.cssText = `
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        
        // 创建时长
        if (page.duration) {
            const durationSpan = document.createElement('span');
            durationSpan.textContent = formatDuration(page.duration);
            durationSpan.style.cssText = `
                color: #aaa;
                font-size: 12px;
                margin-left: 8px;
            `;
            pageItem.appendChild(durationSpan);
        }
        
        pageItem.appendChild(pageNumberSpan);
        pageItem.appendChild(pageTitleSpan);
        
        paginationContainer.appendChild(pageItem);
    });
    
    container.appendChild(paginationContainer);
    return true;
}

// 格式化时长
function formatDuration(seconds) {
    if (typeof seconds !== 'number') {
        if (typeof seconds === 'string') {
            seconds = parseInt(seconds);
        } else {
            return '00:00';
        }
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 尝试从URL或页面获取分P信息
function tryGetPaginationInfo(container) {
    console.log('尝试从URL或页面获取分P信息');
    
    // 尝试从URL获取当前分P
    const url = window.location.href;
    const currentP = url.match(/[?&]p=(\d+)/);
    const currentPage = currentP ? parseInt(currentP[1]) : 1;
    
    // 尝试从页面获取总分P数
    let totalPages = 1;
    
    // 方法1：从页面元素获取
    const pageTotalElements = document.querySelectorAll('.cur-page, .video-info-detail-list span, .bpx-player-ctrl-eplist-menu-title');
    for (const element of pageTotalElements) {
        const text = element.textContent;
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
            totalPages = parseInt(match[2]);
            break;
        }
    }
    
    // 方法2：从视频URL获取
    if (totalPages === 1) {
        // 查找页面上所有可能的分P链接
        const links = document.querySelectorAll('a[href*="?p="]');
        if (links.length > 0) {
            // 找出最大的p值
            let maxP = 1;
            links.forEach(link => {
                const match = link.href.match(/[?&]p=(\d+)/);
                if (match) {
                    const p = parseInt(match[1]);
                    if (p > maxP) maxP = p;
                }
            });
            totalPages = maxP;
        }
    }
    
    // 如果找到了分P信息，创建简单的分P列表
    if (totalPages > 1) {
        console.log(`找到分P信息：当前第${currentPage}P，共${totalPages}P`);
        
        // 创建分P列表容器
        const paginationContainer = document.createElement('div');
        paginationContainer.style.cssText = `
            margin-top: 15px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;
        
        // 获取视频基础URL（移除p参数）
        const baseUrl = url.replace(/([?&])p=\d+(&|$)/, '$1').replace(/\?$/, '');
        const connector = baseUrl.includes('?') ? '&' : '?';
        
        // 创建分P按钮
        for (let i = 1; i <= totalPages; i++) {
            const pageItem = document.createElement('a');
            pageItem.href = `${baseUrl}${connector}p=${i}`;
            const isCurrentPage = i === currentPage;
            
            pageItem.style.cssText = `
                display: flex;
                align-items: center;
                padding: 10px 12px;
                border-radius: 4px;
                background: ${isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
                color: white;
                text-decoration: none;
                transition: all 0.2s;
                ${isCurrentPage ? 'border-left: 3px solid #00a1d6;' : ''}
            `;
            
            // 添加悬停效果
            pageItem.onmouseover = function() {
                this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.5)' : 'rgba(255, 255, 255, 0.2)';
                this.style.transform = 'translateX(3px)';
            };
            
            pageItem.onmouseout = function() {
                this.style.background = isCurrentPage ? 'rgba(0, 161, 214, 0.3)' : 'rgba(255, 255, 255, 0.1)';
                this.style.transform = 'translateX(0)';
            };
            
            // 创建页码
            const pageNumberSpan = document.createElement('span');
            pageNumberSpan.textContent = `P${i}`;
            pageNumberSpan.style.cssText = `
                display: inline-block;
                min-width: 30px;
                text-align: center;
                margin-right: 10px;
                font-weight: bold;
                color: ${isCurrentPage ? '#00a1d6' : '#ccc'};
            `;
            
            pageItem.appendChild(pageNumberSpan);
            pageItem.appendChild(document.createTextNode(`第${i}集`));
            
            paginationContainer.appendChild(pageItem);
        }
        
        // 添加到容器
        container.appendChild(paginationContainer);
        document.body.appendChild(container);
        return true;
    }
    
    return false;
}

// 修改清理函数
function cleanupFullscreen() {
    // 移除视频页面标识
    document.body.classList.remove('video-page');
    
    // 确保只在验证通过且正在退出时执行清理
    if (!passwordVerified || !isExiting) {
        // 如果条件不满足，恢复全屏
        enterFullscreen();
        return;
    }

    // 移除全屏相关的所有样式和类
    const playerContainer = document.querySelector('#bilibili-player');
    if (playerContainer) {
        playerContainer.style.position = '';
        playerContainer.style.top = '';
        playerContainer.style.left = '';
        playerContainer.style.width = '';
        playerContainer.style.height = '';
        playerContainer.style.zIndex = '';
        playerContainer.style.backgroundColor = '';
    }

    // 确保移除所有全屏相关的样式
    document.body.classList.remove('fullscreen-mode');
    document.body.classList.remove('locked');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.documentElement.style.overflow = '';

    // 移除选集按钮和面板
    const playlistButton = document.querySelector('.playlist-button');
    if (playlistButton) playlistButton.remove();
    
    const playlistPanel = document.querySelector('.playlist-panel');
    if (playlistPanel) playlistPanel.remove();

    // 添加恢复全屏按钮
    addFloatingRestoreButton();

    // 重置状态
    setTimeout(() => {
        passwordVerified = false;
        isExiting = false;
        state.setValidating(false);
    }, 1000);
}

// 修改浮动恢复按钮样式和功能
function addFloatingRestoreButton() {
    const button = document.createElement('div');
    button.className = 'restore-fullscreen-btn';
    button.innerHTML = `
        <div class="btn-content">
            <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
            <span>恢复专注模式</span>
        </div>
        <div class="shortcut-tip">按 F11 快速恢复</div>
    `;

    // 添加按钮样式
    const style = document.createElement('style');
    style.textContent = `
        .restore-fullscreen-btn {
            position: fixed;
            right: 20px;
            bottom: 20px;
            background: linear-gradient(135deg, #00a1d6, #00b5e5);
            color: white;
            padding: 12px 20px;
            border-radius: 24px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,161,214,0.4);
            z-index: 999999;
            transition: all 0.3s ease;
            opacity: 0.95;
            user-select: none;
            animation: pulse 2s infinite;
        }

        .btn-content {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .shortcut-tip {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 4px;
        }

        @keyframes pulse {
            0% {
                transform: scale(1);
                box-shadow: 0 4px 12px rgba(0,161,214,0.4);
            }
            50% {
                transform: scale(1.05);
                box-shadow: 0 6px 16px rgba(0,161,214,0.6);
            }
            100% {
                transform: scale(1);
                box-shadow: 0 4px 12px rgba(0,161,214,0.4);
            }
        }

        .restore-fullscreen-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0,161,214,0.5);
            opacity: 1;
            animation: none;
        }

        @media screen and (max-width: 768px) {
            .restore-fullscreen-btn {
                right: 16px;
                bottom: 16px;
                padding: 8px 16px;
                font-size: 13px;
            }
            .shortcut-tip {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);

    // 添加快捷键监听
    const handleKeyPress = (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            restoreFullscreen();
        }
    };

    // 恢复全屏的函数
    const restoreFullscreen = () => {
        button.remove();
        style.remove();
        document.removeEventListener('keydown', handleKeyPress);
        // 重置状态
        passwordVerified = false;
        isExiting = false;
        state.setValidating(false);
        state.setProcessing(false);
        // 重新进入全屏模式
        enterFullscreen();
    };

    // 添加点击事件
    button.addEventListener('click', restoreFullscreen);
    
    // 添加快捷键监听
    document.addEventListener('keydown', handleKeyPress);
    
    document.body.appendChild(button);

    // 5分钟后自动隐藏按钮动画效果
    setTimeout(() => {
        button.style.animation = 'none';
    }, 300000);
}

// 修改清理事件监听器的函数（原cleanup函数改名）
function removeEventListeners() {
    const events = [
        { type: 'keydown', handler: handleKeyPress },
        { type: 'contextmenu', handler: handleContextMenu },
        { type: 'mousedown', handler: preventEvent },
        { type: 'click', handler: preventEvent },
        { type: 'blur', handler: handleWindowBlur },
        { type: 'visibilitychange', handler: handleVisibilityChange },
        { type: 'keydown', handler: handleBrowserShortcuts }
    ];

    events.forEach(({ type, handler }) => {
        document.removeEventListener(type, handler, true);
        window.removeEventListener(type, handler, true);
    });

    // 重新启用所有交互元素
    document.querySelectorAll('input, button, select, textarea, a').forEach(element => {
        element.disabled = false;
        element.style.pointerEvents = '';
    });
}

// 页面加载完成后初始化
window.addEventListener('load', () => {
    if (!window._pluginInitialized) {
    setTimeout(initPlugin, 1000);
    }
}, { once: true });

document.addEventListener('DOMContentLoaded', () => {
    if (!window._pluginInitialized) {
    setTimeout(initPlugin, 1000);
    }
}, { once: true });

// 修改音量恢复函数
function restoreVideoVolume() {
    const videoPlayer = getVideoPlayer();
    if (videoPlayer) {
        // 立即尝试取消静音
        videoPlayer.muted = false;
        
        // 如果音量为0，设置默认音量
        if (videoPlayer.volume === 0) {
            videoPlayer.volume = 0.5;
        }

        // 监听播放事件
        videoPlayer.addEventListener('play', function onPlay() {
            // 再次确保不是静音
            videoPlayer.muted = false;
            if (videoPlayer.volume === 0) {
                videoPlayer.volume = 0.5;
            }
            // 移除监听器
            videoPlayer.removeEventListener('play', onPlay);
        });

        // 监听音量变化
        videoPlayer.addEventListener('volumechange', function() {
            // 防止被设置为静音
            if (videoPlayer.muted) {
                videoPlayer.muted = false;
            }
            // 防止音量为0
            if (videoPlayer.volume === 0) {
                videoPlayer.volume = 0.5;
            }
        });
    }
}

// 添加重置密码函数
function resetPassword() {
    // 先验证当前密码
    const oldPassword = prompt('请输入当前密码以验证身份：');
    if (oldPassword !== password) {
        alert('当前密码错误，无法重置！');
        return;
    }

    const newPassword = prompt('请输入新密码：');
    if (!newPassword) {
        alert('密码不能为空！');
        return;
    }

    const confirmPassword = prompt('请再次输入新密码：');
    if (newPassword !== confirmPassword) {
        alert('两次输入的密码不一致！');
        return;
    }

    // 更新密码
    password = newPassword;
    
    // 保存到存储
    storage.set({
        password: newPassword
    }, function() {
        alert('密码已成功重置！\n可以使用 Ctrl + Alt + R 快捷键随时重置。');
    });
}

// 修改错误处理相关代码
window.addEventListener('error', function(e) {
    console.error('全局错误:', e);
    // 尝试恢复基本功能
    safeExecute(() => {
        if (isVideoPage()) {
    enterFullscreen();
        } else {
            restoreOriginalState();
        }
    });
});

// 修改 safeExecute 函数，增加错误处理
function safeExecute(fn, fallback) {
    try {
        const result = fn();
        // 处理 Promise 返回值
        if (result instanceof Promise) {
            return result.catch(error => {
                console.error('异步执行错误:', error);
                if (typeof fallback === 'function') {
                    return fallback(error);
                }
                // 如果没有 fallback，继续抛出错误
                throw error;
            });
        }
        return result;
    } catch (error) {
        console.error('同步执行错误:', error);
        if (typeof fallback === 'function') {
            return fallback(error);
        }
        // 如果没有 fallback，继续抛出错误
        throw error;
    }
}

// 添加安全的异步执行函数
async function safeAsyncExecute(fn, fallback) {
    try {
        return await fn();
    } catch (error) {
        console.error('异步执行错误:', error);
        if (typeof fallback === 'function') {
            return fallback(error);
        }
        // 如果没有 fallback，继续抛出错误
        throw error;
    }
}

// 建议改进：添加简单加密
function encryptPassword(pwd) {
    return btoa(pwd.split('').reverse().join('')); 
}

function decryptPassword(encrypted) {
    return atob(encrypted).split('').reverse().join('');
}

// 建议改进：添加更多备选选择器和错误处理
function getVideoPlayer() {
    const selectors = [
        '.bpx-player-video-wrap video',
        '.bilibili-player-video video',
        '#bilibili-player video',
        'video'  // 最后的备选
    ];
    
    for (const selector of selectors) {
        const player = document.querySelector(selector);
        if (player) return player;
    }
    return null;
}

// 建议改进：添加浏览器前缀支持
function requestFullscreen(element) {
    const methods = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'mozRequestFullScreen',
        'msRequestFullscreen'
    ];
    
    for (const method of methods) {
        if (element[method]) {
            element[method]();
            return true;
        }
    }
    return false;
}

// 添加重试机制
async function retry(fn, maxAttempts = 3) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxAttempts - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 修改首页设置函数
function setupHomePage() {
    try {
        // 添加状态检查
        if (window._homePageSetup) {
            return;
        }
        window._homePageSetup = true;

        // 立即停止原页面加载
        window.stop();
        
        // 使用更安全的方式清空页面
        try {
            document.open();
            document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>');
            document.close();
        } catch (e) {
            console.error('清空页面失败，使用备用方法');
            document.documentElement.innerHTML = '';
        }
    
    // 保存原始标题
        const originalTitle = 'bilibili - 专注学习';
        document.title = originalTitle;

        // 创建并添加新元素
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0';
        document.head.appendChild(meta);

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
                    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
                }

                body {
                    background: #f6f7f8;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }

        .custom-search-container {
                    background: white;
                    padding: 40px 60px;
                    border-radius: 16px;
                    box-shadow: 0 12px 36px rgba(0,0,0,0.1);
                    width: 90%;
                    max-width: 800px;
                    min-width: 600px;
                    animation: slideUp 0.4s ease-out;
                }

                @keyframes slideUp {
                    from { 
                        opacity: 0; 
                        transform: translateY(10px);
                    }
                    to { 
                        opacity: 1; 
                        transform: translateY(0);
                    }
        }

        .custom-search-box {
                    display: flex;
                    position: relative;
                    height: 56px;
        }

        .custom-search-input {
                    flex: 1;
                    height: 100%;
                    padding: 0 25px;
                    font-size: 16px;
                    border: 2px solid #e3e5e7;
                    border-radius: 28px 0 0 28px;
                    outline: none;
                    transition: all 0.25s ease;
                    color: #18191c;
                }

                .custom-search-input::placeholder {
                    color: #9499a0;
                    font-size: 15px;
        }

        .custom-search-input:focus {
                    border-color: #00a1d6;
        }

        .custom-search-btn {
                    width: 120px;
                    height: 100%;
                    background: #00a1d6;
                    color: white;
                    border: none;
                    border-radius: 0 28px 28px 0;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: 500;
                    transition: all 0.25s ease;
                    letter-spacing: 2px;
        }

        .custom-search-btn:hover {
                    background: #00b5e5;
                    letter-spacing: 3px;
                }

            .search-tips {
                margin-top: 20px;
                color: #99a2aa;
                font-size: 14px;
                text-align: center;
                opacity: 0.8;
            }

            .keyboard-shortcut {
                display: inline-block;
                padding: 2px 6px;
                background: #f1f2f3;
                border-radius: 4px;
                margin: 0 2px;
            }

                @media (max-width: 640px) {
                    .custom-search-container {
                        min-width: unset;
                        width: 95%;
                        padding: 30px 20px;
                    }

                    .custom-search-box {
                        height: 48px;
                    }

                    .custom-search-btn {
                        width: 90px;
                    }
                }
        `;
        document.head.appendChild(style);

        // 创建搜索容器
        const container = document.createElement('div');
        container.className = 'custom-search-container';
        
        // 创建搜索表单
        const form = document.createElement('form');
        form.id = 'nav-searchform';
        form.className = 'custom-search-box';
        form.action = '//search.bilibili.com/all';
        form.method = 'get';
        form.target = '_self';

        // 创建搜索输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.name = 'keyword';
        input.className = 'custom-search-input';
        input.placeholder = '搜索你想学习的内容...';
        input.autocomplete = 'off';
        input.autofocus = true;

        // 创建搜索按钮
        const button = document.createElement('button');
        button.type = 'submit';
        button.className = 'custom-search-btn';
        button.textContent = '搜索';

        // 组装元素
        form.appendChild(input);
        form.appendChild(button);
        container.appendChild(form);

        // 添加提示文本
        const tips = document.createElement('div');
        tips.className = 'search-tips';
        tips.innerHTML = '提示：按 <span class="keyboard-shortcut">Enter</span> 快速搜索';
        container.appendChild(tips);

        document.body.appendChild(container);

        // 添加事件处理
        form.addEventListener('submit', function(e) {
                            e.preventDefault();
            const keyword = input.value.trim();
            if (!keyword) return;
            
            const searchUrl = '//search.bilibili.com/all?keyword=' + encodeURIComponent(keyword);
            window.location.href = searchUrl.startsWith('//') ? 'https:' + searchUrl : searchUrl;
        });

        // 自动聚焦输入框
        input.focus();
    } catch (error) {
        console.error('设置首页失败:', error);
        // 使用更友好的错误提示
        document.body.innerHTML = `
            <div style="text-align: center; padding: 20px; font-family: sans-serif;">
                <h2 style="color: #333;">搜索功能暂时不可用</h2>
                <p style="margin-top: 10px;">
                    <a href="https://search.bilibili.com" style="color: #00a1d6; text-decoration: none;">
                        点击这里前往哔哩哔哩搜索
                    </a>
                </p>
            </div>
        `;
    }
}

// 添加快捷键设置函数
function setupShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl + Alt + R: 重置密码和提醒语
        if (e.ctrlKey && e.altKey && e.key.toLowerCase() === SHORTCUT_KEYS.RESET_PASSWORD) {
            e.preventDefault();
            resetPassword();
        }
    });
}

// 修改进入全屏函数，确保正确执行
function enterFullscreen() {
    console.log('尝试进入全屏模式');
    if (!isVideoPage() || isExiting || passwordVerified || state.isProcessing) {
        console.log('不满足进入全屏条件');
        return;
    }

    window.focus();
    isManualFullscreen = true;
    hideElements();
    
    const playerContainer = document.querySelector('#bilibili-player');
    if (playerContainer) {
        console.log('找到播放器容器，应用全屏样式');
        useBackupFullscreen(playerContainer);
        setupExitListeners();
    } else {
        console.log('等待播放器容器加载');
        waitForElement('#bilibili-player', (container) => {
            useBackupFullscreen(container);
            setupExitListeners();
        });
    }

    // 恢复视频播放
    const videoPlayer = getVideoPlayer();
    if (videoPlayer) {
        videoPlayer.muted = false;
        if (videoPlayer.volume === 0) {
            videoPlayer.volume = 0.5;
        }
        videoPlayer.play().catch(() => {
            document.addEventListener('click', () => {
                videoPlayer.play().catch(() => {});
            }, { once: true });
        });
    }

    setTimeout(() => {
        isManualFullscreen = false;
    }, 100);
}

// 优化备用全屏方案
function useBackupFullscreen(playerContainer) {
    // 设置容器样式
    playerContainer.style.position = 'fixed';
    playerContainer.style.top = '0';
    playerContainer.style.left = '0';
    playerContainer.style.width = '100vw';
    playerContainer.style.height = '100vh';
    playerContainer.style.zIndex = '2147483647';
    playerContainer.style.background = 'black';
    
    // 模拟全屏状态
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    // 添加全屏样式
    const style = document.createElement('style');
    style.textContent = `
        #bilibili-player {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 2147483647 !important;
            background: black !important;
        }
        
        /* 确保视频内容正确显示 */
        #bilibili-player video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
        }
    `;
    style.setAttribute('data-plugin-style', 'true');
    document.head.appendChild(style);
}

// 修改 setupPageBehavior 函数，确保完全恢复页面滚动
function setupPageBehavior() {
    if (!isVideoPage() && !isHomePage()) {
        // 清理所有限制性样式
        const elementsToClean = [document.documentElement, document.body];
        const stylesToReset = [
            'overflow',
            'height',
            'position',
            'width',
            'top',
            'left',
            'right',
            'bottom',
            'margin',    // 添加这些可能影响滚动的样式
            'padding',
            'min-height',
            'max-height',
            'min-width',
            'max-width',
            'transform',
            'pointer-events'
        ];
        
        elementsToClean.forEach(element => {
            // 完全重置样式
            stylesToReset.forEach(style => {
                element.style[style] = '';
            });
            // 确保滚动行为恢复
            element.style.overflow = 'visible';
            element.style.height = 'auto';
        });

        // 移除所有可能影响滚动的类
        document.body.classList.remove('video-page');
        document.body.classList.remove('fullscreen-mode');
        document.body.classList.remove('locked');
        
        // 清理播放器容器样式
        const player = document.querySelector('#bilibili-player');
        if (player) {
            player.style.cssText = '';
            player.style.position = 'static';  // 确保播放器不会固定定位
        }

        // 移除所有插件添加的样式表
        document.querySelectorAll('style[data-plugin-style]').forEach(style => {
            style.remove();
        });

        // 移除事件监听器
        removeEventListeners();

        // 恢复所有元素的交互能力
        document.querySelectorAll('*').forEach(element => {
            element.style.pointerEvents = '';
        });

        // 确保页面可以滚动
        window.scrollTo = window.oldScrollTo || window.scrollTo;
        window.onscroll = null;
        
        // 移除可能的滚动锁定
        document.documentElement.style.scrollBehavior = '';
        document.body.style.scrollBehavior = '';
    }
}

// 修改 restoreOriginalState 函数，优化布局恢复
function restoreOriginalState() {
    try {
        // 1. 首先移除所有插件添加的样式和类
        document.querySelectorAll('style[data-plugin-style]').forEach(style => {
            style.remove();
        });
        
        // 2. 恢复基本布局
        const baseStyles = document.createElement('style');
        baseStyles.textContent = `
            /* 基础重置 */
            html, body {
                overflow-y: auto !important;
                overflow-x: hidden !important;
                height: auto !important;
                min-height: 100% !important;
                width: 100% !important;
                position: relative !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #f6f7f8 !important;
            }
            
            /* 隐藏干扰元素 */
            .bili-header .right-entry,
            .bili-header .left-entry,
            .bili-header__banner,
            .international-header .mini-header,
            .nav-tabs__item:not(.nav-tabs__item[title="视频"]),
            .filter-wrap__sort,
            .video-list-item__info .up-name,
            .video-list-item__info .danmaku,
            .bili-footer,
            .side-buttons,
            .ad-report,
            [class*="banner"],
            [class*="popup"],
            [class*="activity"],
            [class*="promotion"],
            .search-condition-wrap .sub-filter:not(.sub-filter:first-child) {
                display: none !important;
            }
            
            /* 简化顶部导航 */
            .bili-header__bar {
                height: 48px !important;
                background: #fff !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                z-index: 1000 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0 16px !important;
            }
            
            /* 搜索结果布局优化 */
            .search-container {
                max-width: 1000px !important;
                margin: 64px auto 20px !important;
                padding: 0 16px !important;
                display: flex !important;
                gap: 16px !important;
            }
            
            /* 简化筛选栏 */
            .search-condition-wrap {
                width: 180px !important;
                background: #fff !important;
                border-radius: 8px !important;
                padding: 12px !important;
                position: sticky !important;
                top: 64px !important;
                height: fit-content !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
            }
            
            /* 优化结果列表 */
            .search-content {
                flex: 1 !important;
                background: transparent !important;
            }
            
            /* 美化视频卡片 */
            .video-item {
                background: #fff !important;
                border-radius: 8px !important;
                margin-bottom: 12px !important;
                padding: 12px !important;
                transition: transform 0.2s ease !important;
                display: flex !important;
                gap: 12px !important;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
            }
            
            .video-item:hover {
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1) !important;
            }
            
            /* 简化视频信息 */
            .video-item__info {
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
            }
            
            .video-item__title {
                font-size: 16px !important;
                font-weight: 500 !important;
                color: #18191c !important;
                line-height: 1.4 !important;
                margin-bottom: 4px !important;
            }
            
            .video-item__desc {
                font-size: 13px !important;
                color: #61666d !important;
                line-height: 1.5 !important;
                display: -webkit-box !important;
                -webkit-line-clamp: 2 !important;
                -webkit-box-orient: vertical !important;
                overflow: hidden !important;
            }
            
            /* 简化分页控件 */
            .pagination-wrap {
                display: flex !important;
                justify-content: center !important;
                margin: 24px 0 !important;
                padding: 12px 0 !important;
            }
            
            .pagination-btn {
                min-width: 32px !important;
                height: 32px !important;
                border: 1px solid #e3e5e7 !important;
                border-radius: 4px !important;
                margin: 0 4px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                color: #61666d !important;
                background: #fff !important;
                transition: all 0.2s ease !important;
            }
            
            .pagination-btn:hover {
                border-color: #00a1d6 !important;
                color: #00a1d6 !important;
            }
            
            /* 响应式优化 */
            @media screen and (max-width: 768px) {
                .search-container {
                    flex-direction: column !important;
                    margin-top: 56px !important;
                }
                
                .search-condition-wrap {
                    width: 100% !important;
                    position: relative !important;
                    top: 0 !important;
                    margin-bottom: 12px !important;
                }
                
                .video-item {
                    flex-direction: column !important;
                }
                
                .video-item__title {
                    font-size: 15px !important;
                }
            }
        `;
        document.head.appendChild(baseStyles);
        
        // 3. 移除限制类
        const classesToRemove = [
            'video-page',
            'fullscreen-mode',
            'locked',
            'no-scroll'
        ];
        classesToRemove.forEach(className => {
            document.body.classList.remove(className);
            document.documentElement.classList.remove(className);
        });

        // 4. 恢复所有元素的原始状态
        const elementsToRestore = [
            document.documentElement,
            document.body,
            document.querySelector('.search-container'),
            document.querySelector('.bili-header'),
            document.querySelector('.search-content'),
            ...document.querySelectorAll('.video-item')
        ].filter(Boolean);

        elementsToRestore.forEach(element => {
            element.style.cssText = '';
            element.style.position = '';
            element.style.overflow = '';
            element.style.height = '';
            element.style.width = '';
            element.style.zIndex = '';
            element.style.display = '';
            element.style.visibility = '';
            element.style.opacity = '';
            element.style.transform = '';
        });

        // 5. 恢复交互能力
        document.querySelectorAll('a, button, input, select, textarea, [role="button"]').forEach(element => {
            element.disabled = false;
            element.style.pointerEvents = 'auto';
            element.style.cursor = 'pointer';
            element.style.opacity = '1';
            // 移除事件阻止
            element.onclick = null;
            element.onmousedown = null;
            element.onkeydown = null;
        });

        // 6. 恢复滚动行为
        window.onscroll = null;
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
        
        // 7. 移除事件监听器
        removeEventListeners();

        // 8. 恢复默认行为
        document.oncontextmenu = null;

        // 9. 移除遮罩
        document.querySelectorAll('.global-overlay, .modal-overlay').forEach(overlay => {
            overlay.remove();
        });

        // 10. 强制重新计算布局
        window.dispatchEvent(new Event('resize'));
        
        // 11. 延迟清理
        setTimeout(() => {
            baseStyles.remove();
            // 确保滚动正常
            document.body.style.overflow = 'auto';
            document.documentElement.style.overflow = 'auto';
            // 恢复滚动位置
            if (window.lastScrollPosition) {
                window.scrollTo(0, window.lastScrollPosition);
                delete window.lastScrollPosition;
            }
        }, 100);

    } catch (error) {
        console.error('恢复原始状态失败:', error);
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
    }
}

// 添加搜索框清理函数
function cleanupSearchSuggestions() {
    // 移除所有搜索建议和热榜相关元素
    const elementsToRemove = [
        '.search-panel',
        '.trending-panel',
        '.history-panel',
        '.suggest-panel',
        '[class*="trending"]',
        '[class*="history"]'
    ];
    
    elementsToRemove.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.remove();
        });
    });
}

// 在 restoreOriginalState 函数调用后执行清理
setTimeout(cleanupSearchSuggestions, 200);

// 添加清理函数
function cleanupHomePage() {
    window._homePageSetup = false;
    window._pluginInitialized = false;
    
    // 清理可能的残留样式
    document.querySelectorAll('style[data-plugin-style]').forEach(style => {
        style.remove();
    });
}

// 在页面卸载时清理
window.addEventListener('unload', cleanupHomePage);
