const { defineConfig } = require("@playwright/test");

// 프로덕션(chewstep.com, qwfsk 백엔드) 대상 스모크. 실패 시 스크린샷/트레이스/비디오 보존.
module.exports = defineConfig({
  testDir: "./tests",
  timeout: 150000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://chewstep.com",
    actionTimeout: 20000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
