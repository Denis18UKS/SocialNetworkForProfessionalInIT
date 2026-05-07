const axios = require('axios');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// URL для GitHub API
const GITHUB_API_BASE = 'https://api.github.com';   

// Получение списка репозиториев
router.get('/repos/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const response = await axios.get(`${GITHUB_API_BASE}/users/${username}/repos`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Получение коммитов
router.get('/repos/:username/:repoName/commits', async (req, res) => {
    const { username, repoName } = req.params;
    try {
        const response = await axios.get(`${GITHUB_API_BASE}/repos/${username}/${repoName}/commits`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Скачать архив репозитория
router.get('/repos/:username/:repoName/download', async (req, res) => {
    const { username, repoName } = req.params;
    console.log(`Запрос на скачивание репозитория: ${username}/${repoName}`);

    const repoUrl = `https://github.com/${username}/${repoName}/archive/refs/heads/main.zip`;
    console.log(`Запрос на скачивание для пользователя: ${username}, репозиторий: ${repoName}`);

    try {
        const response = await axios.get(repoUrl, { responseType: 'arraybuffer' });

        // Устанавливаем CORS заголовки
        res.setHeader('Access-Control-Allow-Origin', '*');  // Разрешаем запросы с любых источников
        res.setHeader('Access-Control-Allow-Methods', 'GET');  // Разрешаем GET запросы
        res.setHeader('Content-Type', 'application/zip');  // Указываем тип контента как zip
        res.setHeader('Content-Disposition', `attachment; filename=${repoName}.zip`);  // Указываем имя файла

        // Отправляем архив
        res.send(response.data);
    } catch (error) {
        console.error('Ошибка при скачивании репозитория:', error.message);
        res.status(404).json({ message: 'Репозиторий не найден или доступ к нему ограничен.' });
    }
});

module.exports = router;
