---
title: "Arcadia"
description: "以原生网页浏览为入口，把阅读、保存、检索、AI 问答与隐私控制连接起来的本地优先桌面工具。"
tagline: "浏览不是终点。把网页变成留在本地、随时可以找回和继续使用的知识。"
category: "桌面知识浏览器"
platforms: ["Windows 10/11"]
status: "development"
featured: true
icon: "/images/arcadia.png"
version: "0.6.0"
updatedAt: 2026-10-30
features: ["原生多标签与工作区", "Reader 正文提取与 Markdown 保存", "本地 FTS5 与混合检索", "页面摘要、翻译与引用问答", "历史、书签与可续传下载", "私密标签、权限与追踪拦截", "OpenAI Compatible 与 Ollama", "WASM 插件与受控 Agent"]
---

Arcadia 不是一个只有聊天框的网页外壳。它以独立 WebView 标签页承载真实浏览，在同一个桌面应用中连接历史、书签、工作区、下载、阅读器、知识库、搜索和 AI 助手。

## 从网页到本地知识

打开文章后，Reader 使用 Mozilla Readability 提取正文，并通过 Turndown 转换为 Markdown。保存时，正文、来源和结构化元数据写入本地 SQLite；之后可以使用星标、标签、集合、笔记、全文搜索和 Markdown 导出继续整理。

## 搜索结果，也保留来源

本地检索使用 SQLite FTS5，并结合向量召回、BM25、RRF 与重排。AI 支持当前页面摘要、翻译与问答，也能对知识库进行带引用的跨文档问答。Provider 支持 OpenAI Compatible 与 Ollama，API Key 存入系统密钥环。

## 浏览器该有的能力

Arcadia 已实现多标签、标签搜索与分组、私密标签、多工作区、会话与崩溃恢复、最近关闭标签、历史、书签、站点权限，以及支持暂停、取消、重试和 Range 续传的下载中心。

## 隐私不是一句口号

知识库和浏览数据默认留在设备上。Windows 版本提供广告与追踪请求拦截、站点级开关、封杀名单、证书错误处理和真实拦截统计。私密标签不会写入历史、关闭记录、站点权限或表单数据。

## 当前状态

v0.6.0 已具备主要功能链路，当前重点是界面收口、安装签名、发布流程和跨平台回归。Windows 是现阶段真实验证平台；macOS 与 Linux 的部分隐私和证书能力仍受系统 WebView 接口限制。
