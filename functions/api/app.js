/**
 * ==========================================
 * 📊 全局核心数据源 (全平台分类全部配置完毕)
 * ==========================================
 */
const TG_DATA = {
    // 轮播图数据 (带独立跳转 HTML 与操作按钮文字)
    sliders: [
        { 
            id: 101, 
            title: "重制上线，即刻迁移到新页面", 
            slogan: "全新网站再次出发", 
            image: "https://picsum.photos/id/367/1600/900", 
            url: "index.html",
            btnText: "进入页面"
        },
        { 
            id: 102, 
            title: "AI Searcher BETA", 
            slogan: "全新设计的 AI 智能多端聚合搜索模块", 
            image: "https://picsum.photos/id/1069/1600/900", 
            url: "search.html",
            btnText: "进入搜索"
        },
        { 
            id: 103, 
            title: "聚合下载中心", 
            slogan: "访问底层核心下载站，快速搜寻构建资源", 
            image: "https://picsum.photos/id/1071/1600/900", 
            url: "download.html",
            btnText: "前往下载"
        }
    ],
    // 产品矩阵数据 (涵盖：hot-推荐, pc-电脑, mobile-移动, embedded-嵌入式)
    games: [
        { name: "核心系统基座 (推荐)", type: ["hot", "pc"], sub: "底座系统 · 稳定运行", cover: "https://picsum.photos/400/533?random=1", url: "search.html" },
        { name: "数据可视化大屏 (推荐)", type: ["hot", "pc"], sub: "实时同步 · 多端联动", cover: "https://picsum.photos/400/533?random=2", url: "info.html" },
        { name: "自动化高级编译器", type: ["pc"], sub: "高效编译 · 彻底杜绝崩溃", cover: "https://picsum.photos/400/533?random=3", url: "search.html" },
        { name: "智能终端边缘计算", type: ["embedded", "hot"], sub: "Cloudflare 静态底座协同", cover: "https://picsum.photos/400/533?random=4", url: "info.html" },
        { name: "移动端流控快捷面板", type: ["mobile", "hot"], sub: "掌上控制 · 随时随地", cover: "https://picsum.photos/400/533?random=5", url: "search.html" },
        { name: "嵌入式核心固件分发", type: ["embedded"], sub: "安全分发 · 固件级更新", cover: "https://picsum.photos/400/533?random=6", url: "info.html" }
    ]
};

/**
 * ==========================================
 * 🚀 全局状态
 * ==========================================
 */
let currentIdx = 0;
let autoplayTimer = null;
let heroBgStage, heroIndicators, heroMetaPanel;

/**
 * ==========================================
 * 🎬 1. 轮幕渲染与状态控制模块
 * ==========================================
 */
function initHeroCarousel() {
    heroBgStage = document.getElementById('heroBgStage');
    heroIndicators = document.getElementById('heroIndicators');
    heroMetaPanel = document.getElementById('heroMetaPanel');

    if (!heroBgStage || !heroIndicators) return;

    // 渲染背景组件
    heroBgStage.innerHTML = '';
    TG_DATA.sliders.forEach((slide, idx) => {
        const slideDiv = document.createElement('div');
        slideDiv.className = `hero-bg-slide ${idx === 0 ? 'active' : ''}`;
        slideDiv.style.backgroundImage = `url('${slide.image}')`;
        heroBgStage.appendChild(slideDiv);
    });

    // 渲染指示器圆点
    heroIndicators.innerHTML = '';
    TG_DATA.sliders.forEach((_, idx) => {
        const pill = document.createElement('div');
        pill.className = `ind-pill ${idx === 0 ? 'active' : ''}`;
        pill.setAttribute('data-index', idx);
        heroIndicators.appendChild(pill);
    });

    // 绘制首帧
    updateCarouselState();

    // 监听圆点点击
    heroIndicators.addEventListener('click', (e) => {
        if (e.target.classList.contains('ind-pill')) {
            const targetIdx = parseInt(e.target.getAttribute('data-index'));
            switchSlide(targetIdx);
            resetAutoplay();
        }
    });

    // 左右方向键支持
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => { switchSlide(currentIdx - 1); resetAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { switchSlide(currentIdx + 1); resetAutoplay(); });

    startAutoplay();
}

function updateCarouselState() {
    const currentSlide = TG_DATA.sliders[currentIdx];
    if (!currentSlide || !heroMetaPanel) return;

    heroMetaPanel.innerHTML = ''; 

    const h1 = document.createElement('h1');
    h1.textContent = currentSlide.title;

    const p = document.createElement('p');
    p.textContent = currentSlide.slogan;

    // 独立的动态跳转操作按钮
    const actionBtn = document.createElement('a');
    actionBtn.className = 'hero-action-btn';
    actionBtn.href = currentSlide.url || '#';
    actionBtn.textContent = currentSlide.btnText || '立即体验';
    actionBtn.target = '_self';

    heroMetaPanel.appendChild(h1);
    heroMetaPanel.appendChild(p);
    heroMetaPanel.appendChild(actionBtn);
}

function switchSlide(nextIdx) {
    const slides = document.querySelectorAll('.hero-bg-slide');
    const pills = document.querySelectorAll('.ind-pill');
    if (!slides.length || !pills.length) return;

    if (nextIdx >= TG_DATA.sliders.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = TG_DATA.sliders.length - 1;

    slides[currentIdx].classList.remove('active');
    pills[currentIdx].classList.remove('active');

    currentIdx = nextIdx;
    slides[currentIdx].classList.add('active');
    pills[currentIdx].classList.add('active');

    updateCarouselState();
}

function startAutoplay() {
    autoplayTimer = setInterval(() => { switchSlide(currentIdx + 1); }, 5000);
}

function resetAutoplay() {
    clearInterval(autoplayTimer);
    startAutoplay();
}

/**
 * ==========================================
 * 🎛️ 2. 产品矩阵渲染模块 (DOM 树挂载法，杜绝字符露白)
 * ==========================================
 */
function renderMatrixGrid(filterType = 'hot') {
    const tgGameGrid = document.getElementById('tgGameGrid');
    if (!tgGameGrid) return;

    tgGameGrid.innerHTML = ''; 

    const filteredGames = TG_DATA.games.filter(game => game.type.includes(filterType));

    filteredGames.forEach(game => {
        const card = document.createElement('a');
        card.className = 'tg-item-card';
        card.href = game.url || '#';
        card.target = '_self';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'tg-card-img-wrapper';

        const img = document.createElement('img');
        img.src = game.cover;
        img.alt = game.name;

        const info = document.createElement('div');
        info.className = 'tg-card-info';

        const title = document.createElement('h3');
        title.textContent = game.name;

        const sub = document.createElement('p');
        sub.textContent = game.sub;

        imgWrapper.appendChild(img);
        info.appendChild(title);
        info.appendChild(sub);
        card.appendChild(imgWrapper);
        card.appendChild(info);
        
        tgGameGrid.appendChild(card);
    });
}

/**
 * ==========================================
 * 🗂️ 3. 分类导航激活模块
 * ==========================================
 */
function initTabs() {
    const tabNav = document.querySelector('.tg-tab-nav');
    if (!tabNav) return;

    tabNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.tg-tab-btn');
        if (!btn) return;

        document.querySelectorAll('.tg-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.getAttribute('data-filter') || 'hot';
        renderMatrixGrid(filter);
    });
}

/**
 * ==========================================
 * 🔔 4. 公告历史面板与智能自动开屏弹窗逻辑
 * ==========================================
 */
function initNoticeBoard() {
    const closeNoticeBtn = document.getElementById('closeNoticeBtn');
    const noticeOverlay = document.getElementById('noticeOverlay');
    
    // 一打开页面，直接强制让公告遮罩层在屏幕居中显示 
    if (noticeOverlay) {
        noticeOverlay.style.display = 'flex'; 
    }

    // 绑定关闭按钮
    if (closeNoticeBtn && noticeOverlay) {
        closeNoticeBtn.addEventListener('click', () => {
            noticeOverlay.style.display = 'none'; 
        });
    }

    // 手风琴折叠栏支持
    const accordionContainer = document.querySelector('.accordion-container');
    if (accordionContainer) {
        accordionContainer.addEventListener('click', (e) => {
            const header = e.target.closest('.accordion-header');
            if (!header) return;

            const item = header.parentElement;
            if (item) {
                item.classList.toggle('active'); 
            }
        });
    }
}

/**
 * ==========================================
 * 🔝 5. 🛠️ 侧边栏工具箱多功能联动模块
 * ==========================================
 */
function initSidebarToolbar() {
    // ---- 5.1 回到顶部逻辑 ----
    const backBtn = document.getElementById('scrollToTopBtn');
    if (backBtn) {
        backBtn.style.display = 'none'; // 初始化先隐藏

        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backBtn.style.display = 'flex'; 
            } else {
                backBtn.style.display = 'none';
            }
        });

        backBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---- 5.2 🌟 核心修复：“回到主页”点击跳转逻辑 ----
    const popovers = document.querySelectorAll('.toolbar-popover');
    popovers.forEach(popover => {
        // 自动识别包含“回到主页”文字的提示框
        if (popover.textContent.trim() === '回到主页') {
            const parentItem = popover.closest('.toolbar-item');
            
            if (parentItem) {
                // 变成小手光标，增加可点击暗示
                parentItem.style.cursor = 'pointer'; 
                
                // 无论是点中图标还是点中悬浮文字，统统回主页
                parentItem.addEventListener('click', () => {
                    window.location.href = 'index.html';
                });
            }
        }
    });
}

/**
 * ==========================================
 * 🏁 6. 主入口执行
 * ==========================================
 */
document.addEventListener('DOMContentLoaded', () => {
    initHeroCarousel();      // 启动巨幕
    renderMatrixGrid('hot'); // 默认加载首屏推荐
    initTabs();              // 分类监听
    initNoticeBoard();       // 激活公告并自动开屏弹窗
    initSidebarToolbar();    // 🌟 启动侧边栏多功能工具箱
});
