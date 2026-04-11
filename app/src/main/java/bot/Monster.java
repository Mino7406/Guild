package bot;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.emoji.Emoji;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.components.buttons.Button;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.awt.Color;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Monster extends ListenerAdapter {

    // 💡 도감에 등록된 몬스터 공식 이름 목록 (새 몬스터 추가 시 여기에 이름 추가)
    private final String[] monsterList = {
        "레 다우", "우드 투나", "누 이그드라", "진 다하드", "리오레우스", "조 시아", 
        "알슈베르도", "고어 마가라", "타마미츠네", "라기아크루스", "셀레기오스", "오메가 플라네테스", "고그마지오스"
    };

    private final Map<String, List<String>> monsterAliases = new HashMap<>();

    public Monster() {
        // 💡 대체어 등록 (공식 이름, 별명 목록)
        monsterAliases.put("레 다우", Arrays.asList("레다우", "레", "레황", "황뢰룡"));
        monsterAliases.put("우드 투나", Arrays.asList("우드", "우드투나", "참치", "나무참치", "나무 참치", "파의룡"));
        monsterAliases.put("누 이그드라", Arrays.asList("누", "누이그드라", "누따끄", "마따끄", "문어", "염옥소"));
        monsterAliases.put("진 다하드", Arrays.asList("진다", "진다하드", "찐따하드", "이긴다 소프트", "동봉룡"));
        monsterAliases.put("리오레우스", Arrays.asList("레우스", "리오", "화룡"));
        monsterAliases.put("조 시아", Arrays.asList("바퀴벌레", "조시아", "백열룡"));
        monsterAliases.put("고어 마가라", Arrays.asList("고어마가라", "고어", "마가라", "고아", "흑식룡"));
        monsterAliases.put("알슈베르도", Arrays.asList("알슈", "뉴트리아", "나타", "쇄인룡"));
        monsterAliases.put("타마미츠네", Arrays.asList("타마", "미츠네", "여우", "거품", "포호룡"));
        monsterAliases.put("라기아크루스", Arrays.asList("라기", "라기아", "악어", "해룡"));
        monsterAliases.put("셀레기오스", Arrays.asList("셀레기", "제트킥", "째트킥", "셀레", "천인룡"));
        monsterAliases.put("오메가 플라네테스", Arrays.asList("오메가", "파판", "파이널판타지", "파이널 판타지", "기계", "메카", "풍뎅이", "병신"));
        monsterAliases.put("고그마지오스", Arrays.asList("고그마", "고구마", "거극룡", "거극", "파룡포", "기름"));
    }

    private String resolveMonsterName(String input) {
        for (String official : monsterList) {
            if (official.equals(input)) return official;
        }
        for (Map.Entry<String, List<String>> entry : monsterAliases.entrySet()) {
            for (String alias : entry.getValue()) {
                if (alias.equals(input)) return entry.getKey();
            }
        }
        return input;
    }

    private String getArrayAsString(JsonObject data, String key) {
        if (!data.has(key)) return "정보가 없습니다.";
        if (data.get(key).isJsonArray()) {
            List<String> lines = new ArrayList<>();
            data.getAsJsonArray(key).forEach(element -> lines.add(element.getAsString()));
            return String.join("\n", lines);
        }
        return data.get(key).getAsString();
    }

    @Override
    public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
        if (event.getName().equals("몬스터") && event.getFocusedOption().getName().equals("이름")) {
            String currentInput = event.getFocusedOption().getValue().trim(); 
            List<Command.Choice> options = new ArrayList<>();
            for (String officialName : monsterList) {
                boolean isMatch = officialName.contains(currentInput);
                if (!isMatch && monsterAliases.containsKey(officialName)) {
                    for (String alias : monsterAliases.get(officialName)) {
                        if (alias.contains(currentInput)) { isMatch = true; break; }
                    }
                }
                if (isMatch) {
                    options.add(new Command.Choice(officialName, officialName));
                    if (options.size() >= 25) break;
                }
            }
            event.replyChoices(options).queue();
        }
    }

    private JsonObject getMonsterData(String monsterName) {
        try {
            String fileName = monsterName + ".json";
            InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
            if (is == null) return null;
            return JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception e) { e.printStackTrace(); return null; }
    }

    private List<Button> getTabButtons(String currentTab, String monsterName) {
        List<Button> buttons = new ArrayList<>();
        if (!currentTab.equals("basic")) 
            buttons.add(Button.secondary("basic_" + monsterName, "기본 정보").withEmoji(Emoji.fromFormatted("<:Info_4:1492145251941482697>")));
        if (!currentTab.equals("hitzone")) 
            buttons.add(Button.primary("hitzone_" + monsterName, "육질 정보").withEmoji(Emoji.fromFormatted("<:Info_2:1492145248795758602>")));
        if (!currentTab.equals("drop")) 
            buttons.add(Button.success("drop_" + monsterName, "소재 정보").withEmoji(Emoji.fromFormatted("<:Info_1:1492145247327617185>")));
        if (!currentTab.equals("status")) 
            buttons.add(Button.danger("status_" + monsterName, "상태이상 정보").withEmoji(Emoji.fromFormatted("<:Info_3:1492145250192331015>")));
        return buttons;
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            OptionMapping option = event.getOption("이름");
            if (option == null) return;
            String userInput = option.getAsString().trim();
            String monsterName = resolveMonsterName(userInput); 
            JsonObject monsterData = getMonsterData(monsterName);
            if (monsterData == null) { event.reply("❌ 데이터 없음: `" + userInput + "`").queue(); return; }
            sendBasicPage(event, null, monsterName, monsterData, false);
        }
    }

    @Override
    public void onButtonInteraction(ButtonInteractionEvent event) {
        String[] parts = event.getComponentId().split("_");
        if (parts.length < 2) return;
        String action = parts[0];       
        String monsterName = parts[1];  
        JsonObject monsterData = getMonsterData(monsterName);
        if (monsterData == null) return;

        EmbedBuilder embed = new EmbedBuilder();
        embed.setColor(new Color(184, 56, 56));
        if (monsterData.has("thumbnail")) embed.setThumbnail(monsterData.get("thumbnail").getAsString());

        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String titleText = "# " + icon + monsterName + "\n";

        switch (action) {
            case "basic":
                sendBasicPage(null, event, monsterName, monsterData, true);
                return;
            case "hitzone":
                embed.setDescription(titleText + "\n" + getArrayAsString(monsterData, "hitzone"));
                break;
            case "drop":
                embed.setDescription(titleText + "\n" + getArrayAsString(monsterData, "drop"));
                break;
            case "status":
                embed.setDescription(titleText);
                if (monsterData.has("special_attack")) embed.addField("**《몬스터의 특수 공격》**", getArrayAsString(monsterData, "special_attack"), false);
                embed.addField("**《유효 상태 이상》**", getArrayAsString(monsterData, "status"), true);
                embed.addField("**《유효 아이템》**", getArrayAsString(monsterData, "item"), true);
                break;
        }
        event.editMessageEmbeds(embed.build()).setActionRow(getTabButtons(action, monsterName)).queue();
    }

    private void sendBasicPage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent, String monsterName, JsonObject monsterData, boolean isEdit) {
        EmbedBuilder embed = new EmbedBuilder();
        embed.setColor(new Color(184, 56, 56));
        if (monsterData.has("thumbnail")) embed.setThumbnail(monsterData.get("thumbnail").getAsString());

        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String species = monsterData.get("species").getAsString();
        String threatLevel = monsterData.get("threat_level").getAsString();
        String info = getArrayAsString(monsterData, "info");
        String habitat = monsterData.has("habitat") ? monsterData.get("habitat").getAsString() : "정보 없음";

        embed.setDescription(
            "# " + icon + monsterName + "\n" +
            "**【 " + species + " 】**\n\n" +
            info + "\n\n" +
            "**《위험도》**\n" + threatLevel + "\n\n" +
            "**《서식지》**\n" + habitat
        );

        if (isEdit) {
            buttonEvent.editMessageEmbeds(embed.build()).setActionRow(getTabButtons("basic", monsterName)).queue();
        } else {
            slashEvent.replyEmbeds(embed.build()).addActionRow(getTabButtons("basic", monsterName)).queue();
        }
    }
}