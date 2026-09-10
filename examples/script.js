export const examples = [
    { file: '01.html', title: '01 - A ray between two points', description: 'One ray, one contact, and the cells it crosses on the way.' },
    { file: '02.html', title: '02 - Every contact along a ray', description: 'Every contact along a ray, and the walls they merge into.' },
    { file: '03.html', title: '03 - Two sources at once', description: 'A tile grid and a set of loose rectangles, asked together.' },
    { file: '04.html', title: '04 - A fan of rays', description: 'Four hundred casts, and the polygon their endpoints trace.' },
    { file: '05.html', title: '05 - Moving a rectangle', description: 'How far a rectangle can go, decided by a row of rays.' },
    { file: '06.html', title: '06 - A ray that bounces', description: 'Cast, reflect about the normal, repeat, on a shrinking budget.' },
    { file: '07.html', title: '07 - Definitions and filters', description: 'The same ray cast three times, with three different filters.' },
    { file: '08.html', title: '08 - Fog of war', description: 'The only page that remembers what it has already seen.' },
    { file: '09.html', title: '09 - Thin walls and one-way surfaces', description: 'Thin is geometry, one-way is a rule, and the two are separate.' },
    { file: '10.html', title: '10 - A cone of vision', description: 'A guard, a thirty degree cone, and something to hide from it.' }
];

export function renderMenu(id, current) {
    const here = current || window.location.pathname.split('/').pop();
    const holder = document.getElementById(id);
    const select = document.createElement('select');

    for (var i = 0; i < examples.length; i++) {
        const option = document.createElement('option');
        option.value = examples[i].file;
        option.textContent = examples[i].title;
        option.selected = examples[i].file === here;
        select.appendChild(option);
    }

    select.addEventListener('change', function () {
        window.location.href = select.value;
    });

    holder.innerHTML = '';
    holder.appendChild(select);
}

export function renderTable(id, rows) {
    document.getElementById(id).innerHTML = '<table>' + rows.map(function (row) {
        const span = Math.floor(4 / row.length);
        return '<tr>' + row.map(function (field) {
            return '<td colspan="' + span + '"><span class="name">' + field[0] + '</span>' + field[1] + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</table>';
}

export function round(value) {
    return String(Math.round(value * 100) / 100);
}

export function cellOf(point, grid) {
    return Math.floor(point.x / grid.tileSize) + ', ' + Math.floor(point.y / grid.tileSize);
}

export function faceName(hit) {
    if (hit.normalY < 0) {
        return 'top face';
    }
    if (hit.normalY > 0) {
        return 'bottom face';
    }
    if (hit.normalX < 0) {
        return 'left face';
    }
    return 'right face';
}