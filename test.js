require('dotenv').config();
const axios = require('axios');
const dayjs = require('dayjs');

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    throw new Error('❌ .env에 API_KEY가 없습니다.');
}

// 검색어 설정
const keyword = '학교';

// 최대 가져올 개수 설정 (0이면 무제한)
const maxFetchCount = 1000;

const BID_URL = 'http://apis.data.go.kr/1230000/ao/PubDataOpnStdService/getDataSetOpnStdBidPblancInfo';
const NUM_OF_ROWS = 100;

async function fetchAllBids() {
    const today = dayjs();
    const oneMonthAgo = today.subtract(1, 'month');

    let pageNo = 1;
    let allBids = [];
    let totalCount = 0;

    while (true) {
        const params = {
            serviceKey: API_KEY,
            type: 'json',
            bidNtceBgnDt: oneMonthAgo.format('YYYYMMDD') + '0000',
            bidNtceEndDt: today.format('YYYYMMDD') + '2359',
            pageNo,
            numOfRows: NUM_OF_ROWS
        };

        const { data } = await axios.get(BID_URL, { params });

        if (!data.response || !data.response.body || !data.response.body.items) {
            console.log(`⚠️ ${pageNo}페이지 데이터 없음`);
            break;
        }

        if (pageNo === 1) {
            totalCount = parseInt(data.response.body.totalCount, 10);
            console.log(`✅ 전체 검색 결과 건수: ${totalCount}건`);
        }

        const items = data.response.body.items;
        const bids = Array.isArray(items) ? items : [items];

        if (bids.length === 0) {
            console.log(`⚠️ ${pageNo}페이지 항목 없음`);
            break;
        }

        allBids.push(...bids);

        console.log(`✅ ${pageNo} 페이지 수집 완료 (현재까지 ${allBids.length}건)`);

        if (maxFetchCount > 0 && allBids.length >= maxFetchCount) {
            console.log(`🎯 상위 ${maxFetchCount}건까지만 수집 후 중단`);
            break;
        }

        const fetchedCount = pageNo * NUM_OF_ROWS;
        if (fetchedCount >= totalCount) {
            break;
        }

        pageNo++;
    }

    return allBids;
}

async function main() {
    console.log(`⏳ '${keyword}' 키워드로 최근 1달 입찰공고 전체 조회 시작...`);

    try {
        const allBids = await fetchAllBids();

        // 🔥 여기서 직접 필터링
        const filteredBids = allBids.filter(bid => bid.bidNtceNm && bid.bidNtceNm.includes(keyword));

        console.log(`\n🎯 '${keyword}' 포함된 입찰공고 총 ${filteredBids.length}건 수집 완료\n`);

        filteredBids.forEach((bid, idx) => {
            console.log(`[${idx + 1}] ${bid.bidNtceNm} (입찰번호: ${bid.bidNtceNo})`);
        });
    } catch (error) {
        console.error('❌ 프로그램 에러:', error.message);
    }
}

main();
